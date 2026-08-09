-- 0074 — remove the WhatsApp linking feature. profiles.phone IS the identity.
--
-- wa_links existed to say "this number may be used for WhatsApp". It never
-- carried a fact that profiles.phone did not already hold, and it gated OUTBOUND
-- delivery only — inbound identity had long since learned to fall back to
-- profiles.phone. So the two directions could disagree, and they did: a member
-- whose number was on their profile but absent from wa_links could message the
-- bot and be recognised, yet never receive anything back on WhatsApp. Two active
-- coaches and eleven clients were in exactly that state.
--
-- One number, one column, both directions.
--
-- ORDER MATTERS. Everything that reads or writes the table goes first; the table
-- itself goes last. The web app and the notify worker deploy separately (the
-- worker is a manual `supabase functions deploy notify`), so BOTH must be live
-- before this migration is applied.

-- ── 1. Safety net ──────────────────────────────────────────────────────────
-- Verified zero on production at authoring time (46/46 wa_links rows already
-- matched profiles.phone exactly: no nulls, no mismatches, no orphans). This
-- runs anyway, because review_signup_request below could mint a divergent row
-- at any point between authoring and apply, and a member whose only number
-- lived in wa_links would otherwise be auto-provisioned a SECOND account on
-- their next message — stranding bookings, credits and membership on the first.
--
-- Cannot use `on conflict (phone)`: profiles_phone_key is a PARTIAL unique
-- index (where phone is not null), which Postgres will not accept as a conflict
-- inference target (42P10). The NOT EXISTS guard does the same job.
update public.profiles p
   set phone = l.phone
  from public.wa_links l
 where l.user_id = p.id
   and p.phone is null
   and not exists (
     select 1 from public.profiles other
      where other.phone = l.phone
        and other.id <> p.id
   );

do $$
declare
  v_stranded int;
begin
  select count(*) into v_stranded
    from public.wa_links l
    join public.profiles p on p.id = l.user_id
   where p.phone is null;
  if v_stranded > 0 then
    raise exception
      'Refusing to drop wa_links: % linked account(s) still have no profiles.phone. '
      'Resolve the phone collisions the backfill skipped before re-running.',
      v_stranded;
  end if;
end $$;

-- ── 2. Stop the last writer ────────────────────────────────────────────────
-- review_signup_request wrote wa_links on approve. It is called by BOTH the
-- admin action and the founder's WhatsApp "Approve" button, so it must be
-- replaced before the table disappears or every approval starts erroring.
-- Body is unchanged except that the wa_links block is gone: the phone is
-- already on the profile, which is now the whole binding.
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

    v_first := coalesce(nullif(split_part(btrim(v_profile.full_name), ' ', 1), ''), 'there');
    insert into notifications (user_id, type, title, body, data)
    values (p_client, 'signup_approved', 'You''re approved!',
      'Welcome to Sharwin TTA — tap below to finish setting up your account.',
      jsonb_build_object('first_name', v_first, 'url', '/app'));
  else
    update profiles set approval_status = 'denied' where id = p_client;
  end if;

  update notifications set read_at = now()
  where type = 'signup_request'
    and data->>'client_id' = p_client::text
    and read_at is null;

  return jsonb_build_object('ok', true,
    'status', case when p_approve then 'approved' else 'denied' end);
end;
$function$;

-- ── 3. Trigger, then its function ──────────────────────────────────────────
-- The trigger goes with the table, but a SECURITY DEFINER function does not —
-- dropping the table would leave ops_notify_wa_linked() orphaned in the schema.
drop trigger if exists wa_links_ops_feed on public.wa_links;
drop function if exists public.ops_notify_wa_linked();

-- ── 4. Policy, then the table ──────────────────────────────────────────────
-- "founder reads wa links" (migration 0069) existed to answer "which coaches
-- are on WhatsApp". That question now reads
--   find clients role=coach has_phone=not_null
-- against profiles, via the has_phone filter on the `clients` entity.
drop policy if exists "founder reads wa links" on public.wa_links;
drop table if exists public.wa_links;

-- wa_link_codes (the TT-XXXXXX flow) was created in 0010 and already dropped in
-- 0025. Nothing generated or redeemed a code for months; the only surviving
-- trace was a line in the guest system prompt telling people to fetch one from
-- a page that has never rendered it. That line is gone too.
drop table if exists public.wa_link_codes;
