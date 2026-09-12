-- New-user approval gate. The academy is closed-membership: new self-signups
-- must give a name + phone and wait for founder approval before they can enter
-- the app. Existing profiles and founder-invited clients are grandfathered in.
-- (docs/new-user-approval-plan.md)

-- ── State model ──────────────────────────────────────────────────────────────
create type public.signup_approval_status as enum ('pending', 'approved', 'denied');

-- Default 'approved' so every existing row (and any concurrent insert during the
-- deploy) is grandfathered; flip the default to 'pending' immediately after so
-- new self-signups start gated. handle_new_user sets it explicitly from now on.
alter table public.profiles
  add column approval_status public.signup_approval_status not null default 'approved';
alter table public.profiles
  alter column approval_status set default 'pending';

-- ── handle_new_user: coaches auto-approve, clients start pending ──────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_invite public.coach_invites%rowtype;
begin
  select * into v_invite
  from public.coach_invites
  where lower(email) = lower(new.email)
    and claimed_at is null
  order by created_at
  limit 1;

  if found then
    insert into profiles (id, role, full_name, email, phone, approval_status)
    values (
      new.id,
      'coach',
      coalesce(nullif(v_invite.full_name, ''), v_name),
      new.email,
      v_invite.phone,
      'approved'
    )
    on conflict (id) do nothing;

    insert into coaches (
      id, bio, base_lat, base_lng, base_address, active
    )
    values (
      new.id, v_invite.bio,
      coalesce(v_invite.base_lat, 12.9716),
      coalesce(v_invite.base_lng, 77.5946),
      v_invite.base_address,
      true
    )
    on conflict (id) do nothing;

    update public.coach_invites
    set claimed_at = now(), claimed_by = new.id
    where id = v_invite.id;

    return new;
  end if;

  -- Self-signup client: gated until a founder approves (submit_signup_request +
  -- review_signup_request). Explicit here even though the column default covers
  -- it. A founder-invited client auto-approves later via claim_client_invite.
  insert into profiles (id, role, full_name, email, approval_status)
  values (new.id, 'client', v_name, new.email, 'pending')
  on conflict (id) do nothing;

  insert into players (client_id, full_name)
  select new.id, v_name
  where not exists (select 1 from players where client_id = new.id);

  return new;
end;
$function$;

-- ── claim_client_invite: a claimed invite auto-approves the profile ──────────
CREATE OR REPLACE FUNCTION public.claim_client_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite public.client_invites%rowtype;
  v_sub uuid;
  v_minutes integer;
begin
  if new.role <> 'client' then
    return new;
  end if;

  select * into v_invite
  from public.client_invites
  where phone = new.phone
    and claimed_at is null
  order by created_at
  limit 1;
  if not found then
    return new;
  end if;

  -- Founder-invited clients never see the approval gate.
  update profiles
  set approval_status = 'approved'
  where id = new.id and approval_status <> 'approved';

  if coalesce(v_invite.full_name, '') <> '' then
    -- Only fill placeholders; never overwrite a name the client chose.
    update profiles
    set full_name = v_invite.full_name
    where id = new.id and coalesce(full_name, '') = '';

    update players
    set full_name = v_invite.full_name
    where client_id = new.id and full_name in ('', 'there');
  end if;

  if coalesce(v_invite.notes, '') <> '' then
    update players
    set notes = v_invite.notes
    where client_id = new.id
      and notes is null
      and id = (
        select id from players
        where client_id = new.id
        order by created_at
        limit 1
      );
  end if;

  -- Gifted plan: grant a comp subscription (30 days, like the admin comp grant)
  -- plus the plan's private minutes, if any.
  if v_invite.plan_id is not null
     and not exists (
       select 1 from subscriptions
       where client_id = new.id
         and status in ('active', 'trialing', 'past_due')
     )
  then
    insert into subscriptions (
      client_id, plan_id, source, status, current_period_start, current_period_end
    )
    values (new.id, v_invite.plan_id, 'comp', 'active', now(), now() + interval '30 days')
    returning id into v_sub;

    select private_minutes_per_cycle into v_minutes
    from plans where id = v_invite.plan_id;
    if coalesce(v_minutes, 0) > 0 then
      insert into private_credit_ledger (
        client_id, subscription_id, delta_minutes, reason, note
      )
      values (new.id, v_sub, v_minutes, 'grant', 'comp grant (pre-registered)');
    end if;
  end if;

  update public.client_invites
  set claimed_at = now(), claimed_by = new.id
  where id = v_invite.id;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (new.id, 'client.invite_claim', 'client_invites', v_invite.id,
          jsonb_build_object('phone', new.phone, 'plan_id', v_invite.plan_id));

  return new;
end;
$function$;

-- ── is_approved(): RLS helper mirroring is_coach()/is_founder() ───────────────
-- Provided for policies that want to gate a signed-in-but-unapproved client. The
-- reference tables (classes/class_sessions/coaches/venues/plans) are all served
-- to the anonymous marketing site via the anon-readable branch of their existing
-- policies, so gating them here would break the public site and gate nothing an
-- anonymous visitor can't already see — the app-level requireUser redirect is the
-- gate for those. This helper exists for any table later moved off anon reads.
CREATE OR REPLACE FUNCTION public.is_approved()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from profiles
    where id = auth.uid() and approval_status = 'approved'
  );
$function$;

-- ── submit_signup_request(): the applicant's request form ────────────────────
-- Captures name + (already-normalized, E.164) phone, notifies founders, and is
-- idempotent so a user can correct a typo'd phone before the founder acts. If the
-- phone matches a founder pre-registration, claim_client_invite auto-approves and
-- we send no founder request.
CREATE OR REPLACE FUNCTION public.submit_signup_request(p_name text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_profile profiles%rowtype;
  v_old_name text;
  v_name text := nullif(btrim(p_name), '');
  v_status public.signup_approval_status;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'error', 'error', 'not_authenticated');
  end if;

  select * into v_profile from profiles where id = v_uid;
  if not found or v_profile.role <> 'client' then
    return jsonb_build_object('status', 'error', 'error', 'not_client');
  end if;
  if v_profile.approval_status <> 'pending' then
    -- Already approved (e.g. invite) or denied — nothing to submit.
    return jsonb_build_object('status', v_profile.approval_status::text);
  end if;

  v_old_name := v_profile.full_name;

  update profiles set full_name = coalesce(v_name, full_name) where id = v_uid;

  -- Rename the auto-seeded player if it still carries the old profile name
  -- (matches the placeholder-detection ops_notify_new_player uses at signup).
  if v_name is not null then
    update players set full_name = v_name
    where client_id = v_uid and full_name = v_old_name;
  end if;

  -- Phone is unique (the WhatsApp identity). A clash → typed error the action
  -- maps to friendly copy. The update fires claim_client_invite.
  begin
    update profiles set phone = p_phone where id = v_uid;
  exception when unique_violation then
    -- Roll the name back so the row stays consistent with "not submitted yet".
    update profiles set full_name = v_old_name where id = v_uid;
    return jsonb_build_object('status', 'error', 'error', 'phone_taken');
  end;

  -- An invite match just auto-approved us: skip the founder notification.
  select approval_status into v_status from profiles where id = v_uid;
  if v_status = 'approved' then
    return jsonb_build_object('status', 'approved');
  end if;

  -- Idempotent founder ping: update any still-pending request rows in place; only
  -- insert fresh ones when none exist at all (if the first batch already went out
  -- the founder has live buttons — don't double-notify).
  update notifications
  set title = 'New signup request',
      body = coalesce(v_name, 'Someone') || ' (' || v_profile.email || ', ' || p_phone || ') wants access.',
      data = jsonb_build_object(
        'client_id', v_uid,
        'applicant_name', coalesce(v_name, v_old_name),
        'applicant_email', v_profile.email,
        'applicant_phone', p_phone,
        'url', '/admin/players?view=clients')
  where type = 'signup_request'
    and data->>'client_id' = v_uid::text
    and status = 'pending';

  if not found
     and not exists (
       select 1 from notifications
       where type = 'signup_request' and data->>'client_id' = v_uid::text
     ) then
    perform notify_founders('signup_request', 'New signup request',
      coalesce(v_name, 'Someone') || ' (' || v_profile.email || ', ' || p_phone || ') wants access.',
      jsonb_build_object(
        'client_id', v_uid,
        'applicant_name', coalesce(v_name, v_old_name),
        'applicant_email', v_profile.email,
        'applicant_phone', p_phone,
        'url', '/admin/players?view=clients'));
  end if;

  return jsonb_build_object('status', 'pending');
end;
$function$;

-- ── review_signup_request(): the single approve/deny implementation ──────────
-- Both the admin action and the WhatsApp founder buttons call this. Idempotent:
-- a second tap (or admin+WhatsApp race) resolves to already_reviewed.
CREATE OR REPLACE FUNCTION public.review_signup_request(p_client uuid, p_approve boolean, p_reviewer uuid default auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reviewer_role public.user_role;
  v_profile profiles%rowtype;
  v_first text;
begin
  select role into v_reviewer_role from profiles where id = p_reviewer;
  if v_reviewer_role is distinct from 'founder' then
    return jsonb_build_object('ok', false, 'error', 'not_founder');
  end if;
  -- In-app callers act as themselves; belt-and-braces that the session is a
  -- founder's (the WhatsApp path mints the founder's own session too).
  if p_reviewer = auth.uid() and not is_founder() then
    return jsonb_build_object('ok', false, 'error', 'not_founder');
  end if;

  select * into v_profile from profiles where id = p_client for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_profile.approval_status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'already_reviewed',
                              'status', v_profile.approval_status::text);
  end if;

  if p_approve then
    update profiles set approval_status = 'approved' where id = p_client;

    -- Bind the phone for WhatsApp delivery so the approval message reaches a user
    -- who has never messaged the bot. phone uniqueness was enforced at request
    -- time; clear any stale link on either side first (mirrors linkPhoneToUser).
    if v_profile.phone is not null then
      delete from wa_links where user_id = p_client and phone <> v_profile.phone;
      insert into wa_links (phone, user_id)
      values (v_profile.phone, p_client)
      on conflict (phone) do update set user_id = excluded.user_id, linked_at = now();
    end if;

    v_first := coalesce(nullif(split_part(btrim(v_profile.full_name), ' ', 1), ''), 'there');
    insert into notifications (user_id, type, title, body, data)
    values (p_client, 'signup_approved', 'You''re approved!',
      'Welcome to Sharwin TTA — tap below to finish setting up your account.',
      jsonb_build_object('first_name', v_first, 'url', '/app'));
  else
    update profiles set approval_status = 'denied' where id = p_client;
    -- Deny is silent: no notification, no wa_link.
  end if;

  -- Tidy the originating request so the admin feed/list stay clean.
  update notifications set read_at = now()
  where type = 'signup_request'
    and data->>'client_id' = p_client::text
    and read_at is null;

  return jsonb_build_object('ok', true,
    'status', case when p_approve then 'approved' else 'denied' end);
end;
$function$;
