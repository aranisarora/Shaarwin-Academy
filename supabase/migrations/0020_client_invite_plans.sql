-- Pre-registered clients can come with a gifted plan: the admin picks a plan on
-- the invite, and the claim trigger grants a comp subscription (mirroring
-- grantCompCore) the moment the account connects.
--
-- Also: notifications had no INSERT policy at all, so every founder-side
-- "notify the client/coach" insert was silently dropped by RLS. Founders can
-- now write notifications — this fixes existing flows (promote coach, session
-- moved, private booked) and enables broadcast announcements from the bot.

alter table public.client_invites
  add column plan_id uuid references plans(id) on delete set null;

create policy "founder writes notifications" on public.notifications
  as permissive for insert to public with check (is_founder());

create or replace function public.claim_client_invite()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
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
