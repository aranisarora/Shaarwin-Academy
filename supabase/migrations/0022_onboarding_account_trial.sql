-- Onboarding + account-level free trial.
--
-- 1) profiles.onboarded_at — set when the client completes the household
--    onboarding flow. NULL (including all pre-existing clients) routes the
--    user through /app/onboarding via requireUser.
-- 2) The free trial becomes one per ACCOUNT (player_id null) instead of one
--    per player; the account holder chooses which player uses it at booking.
--    Legacy per-player trial credits keep working via _consume_group_credit.

alter table public.profiles add column if not exists onboarded_at timestamptz;

-- One account-level trial per client, ever.
create unique index if not exists class_credits_one_trial_per_client
  on public.class_credits (client_id)
  where type = 'group_trial'::class_credit_type and player_id is null;

-- Stop granting per-player trials.
drop trigger if exists players_grant_trial on public.players;

-- Grant the account trial when the client profile is created.
create or replace function public.grant_signup_trial()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- Free trial: every new client account gets one group-class credit, once,
  -- forever. player_id stays null — the account holder assigns it to a
  -- household player at booking time. Fired by profiles_grant_trial.
  insert into class_credits (client_id, type, source, note)
  values (new.id, 'group_trial', 'signup', 'Free trial class')
  on conflict (client_id) where (type = 'group_trial'::class_credit_type and player_id is null)
  do nothing;
  return new;
end;
$fn$;

drop trigger if exists profiles_grant_trial on public.profiles;
create trigger profiles_grant_trial
  after insert on public.profiles
  for each row when (new.role = 'client'::user_role)
  execute function public.grant_signup_trial();

-- Consume account-level trials too (legacy per-player trials still match).
create or replace function public._consume_group_credit(p_client uuid, p_player uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_id uuid;
begin
  -- Consume one open class credit for a group booking: the free trial first
  -- (account-level or legacy per-player), then any drop-in. Raises
  -- no_entitlement when nothing is available.
  select id into v_id
  from class_credits
  where client_id = p_client and consumed_at is null
    and (
      (type = 'group_trial' and (player_id = p_player or player_id is null))
      or (type = 'group_dropin' and (player_id is null or player_id = p_player))
    )
  order by case when type = 'group_trial' then 0 else 1 end, created_at
  limit 1
  for update skip locked;

  if v_id is null then
    raise exception 'no_entitlement';
  end if;

  update class_credits set consumed_at = now() where id = v_id;
  return v_id;
end;
$fn$;
