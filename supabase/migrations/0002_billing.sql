-- P04 — the subscription gate. Single booking gate for P05/P07/P10.

create or replace function public.get_setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value)::text::int from settings where key = p_key), p_default);
$$;

create or replace function public.has_active_subscription(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from subscriptions s
    where s.client_id = p_client
      and (
        s.status in ('active', 'trialing')
        or (
          s.status = 'past_due'
          and s.current_period_end is not null
          and now() <= s.current_period_end
              + make_interval(days => get_setting_int('dunning_grace_days', 7))
        )
      )
  );
$$;

-- Live private-minutes balance, current period only.
create or replace function public.private_minutes_balance(p_client uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta_minutes), 0)::int
  from private_credit_ledger
  where client_id = p_client;
$$;
