-- 0017: business model rework.
--
-- Monthly billing (was quarterly), frequency-based group plans (1/2/3 a week),
-- private plans sold as sessions-per-week × duration but metered in minutes,
-- free trial group class per player, and one-off purchases (group drop-in,
-- private hours, discounted intro private) via Razorpay Orders.
--
-- Booking entitlement becomes: active *group* subscription OR an unused class
-- credit. Private booking is gated by minutes balance alone — minutes arrive
-- from a private plan grant or a one-off purchase.

-- ── 1) plans: minutes are per billing cycle (now monthly), not per quarter ──
alter table public.plans rename column private_minutes_per_quarter to private_minutes_per_cycle;
alter table public.plans alter column billing_interval_months set default 1;

-- ── 2) class credits (free trial + paid drop-ins) ────────────────────────────
create type public.class_credit_type as enum ('group_trial', 'group_dropin');
create type public.class_credit_source as enum ('signup', 'purchase', 'manual');

create table public.class_credits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  type public.class_credit_type not null,
  source public.class_credit_source not null default 'manual',
  order_id uuid,                                        -- fk added below
  booking_id uuid references public.bookings(id) on delete set null,
  consumed_at timestamptz,
  note text,
  created_at timestamptz default now() not null
);

create index class_credits_client_open_idx
  on public.class_credits (client_id) where consumed_at is null;

-- The free trial is once per player, ever.
create unique index class_credits_one_trial_per_player
  on public.class_credits (player_id) where (type = 'group_trial');

-- ── 3) one-off products + Razorpay orders ────────────────────────────────────
create type public.product_kind as enum ('group_dropin', 'private_oneoff', 'private_intro');

create table public.products (
  id text primary key,                                  -- stable slug used in code
  name text not null,
  description text,
  kind public.product_kind not null,
  price_pence integer not null check (price_pence >= 0),          -- paise
  member_price_pence integer check (member_price_pence >= 0),     -- with an active group plan
  grants_minutes integer not null default 0,            -- private products credit the ledger
  duration_minutes integer,                             -- display only
  active boolean not null default true,
  created_at timestamptz default now() not null
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  product_id text not null references public.products(id),
  razorpay_order_id text unique,
  razorpay_payment_id text,
  amount_pence integer not null,
  currency char(3) not null default 'inr',
  status text not null default 'created',               -- created | paid
  paid_at timestamptz,
  created_at timestamptz default now() not null
);

alter table public.class_credits
  add constraint class_credits_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete set null;

-- Webhook idempotency for one-off payments mirrors subscriptions (invoices).
create unique index if not exists invoices_razorpay_payment_id_key
  on public.invoices (razorpay_payment_id) where razorpay_payment_id is not null;

insert into public.products (id, name, description, kind, price_pence, member_price_pence, grants_minutes, duration_minutes) values
  ('group-dropin',     'Group class — drop-in',
   'One group class, no membership needed.',
   'group_dropin', 34900, 34900, 0, null),
  ('private-60',       'Private session — 60 min',
   'A one-hour session at your home or clubhouse. Coach comes to you.',
   'private_oneoff', 119900, 109900, 60, 60),
  ('private-90',       'Private session — 90 min',
   'A 90-minute session at your home or clubhouse. Coach comes to you.',
   'private_oneoff', 169900, 159900, 90, 90),
  ('private-intro-60', 'Intro offer — first private session (60 min)',
   'Promotional price for your first private session. One per child.',
   'private_intro', 59900, 59900, 60, 60);

-- ── 4) new plan catalogue (monthly) ──────────────────────────────────────────
update public.plans set active = false
where id in ('00000000-0000-4000-8000-0000000000d1',
             '00000000-0000-4000-8000-0000000000d2',
             '00000000-0000-4000-8000-0000000000d3');

-- group_sessions_per_week > 0  → group plan (weekly cap)
-- group_sessions_per_week = 0  → private plan (no group access)
insert into public.plans
  (id, name, description, price_pence, currency, billing_interval_months, group_sessions_per_week, private_minutes_per_cycle) values
  ('00000000-0000-4000-8000-0000000000d4', 'Group — 1×/week',
   'One group class a week.',                                        129900, 'inr', 1, 1, 0),
  ('00000000-0000-4000-8000-0000000000d5', 'Group — 2×/week',
   'Two group classes a week. Our most popular plan.',               239900, 'inr', 1, 2, 0),
  ('00000000-0000-4000-8000-0000000000d6', 'Group — 3×/week',
   'Three group classes a week.',                                    329900, 'inr', 1, 3, 0),
  ('00000000-0000-4000-8000-0000000000d7', 'Private — Weekly, 60 min',
   'A weekly 60-minute home session (260 minutes a month).',         419900, 'inr', 1, 0, 260),
  ('00000000-0000-4000-8000-0000000000d8', 'Private — Weekly, 90 min',
   'A weekly 90-minute home session (390 minutes a month).',         599900, 'inr', 1, 0, 390),
  ('00000000-0000-4000-8000-0000000000d9', 'Private — 2×/week, 60 min',
   'Two 60-minute home sessions a week (520 minutes a month).',      799900, 'inr', 1, 0, 520),
  ('00000000-0000-4000-8000-0000000000da', 'Private — 2×/week, 90 min',
   'Two 90-minute home sessions a week (780 minutes a month).',     1149900, 'inr', 1, 0, 780)
on conflict (id) do nothing;

-- ── 5) entitlement helpers ───────────────────────────────────────────────────

-- Group entitlement: an alive subscription on a plan that includes group
-- classes. NULL cap is legacy "unlimited" (comp plans) and counts as group.
create or replace function public.has_group_subscription(p_client uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
    from subscriptions s
    join plans p on p.id = s.plan_id
    where s.client_id = p_client
      and (p.group_sessions_per_week is null or p.group_sessions_per_week > 0)
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
$function$;

-- Consume one open class credit for a group booking: the player's free trial
-- first, then any drop-in. Raises no_entitlement when nothing is available.
create or replace function public._consume_group_credit(p_client uuid, p_player uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  select id into v_id
  from class_credits
  where client_id = p_client and consumed_at is null
    and (
      (type = 'group_trial' and player_id = p_player)
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
$function$;

-- Free trial: every new player gets one group-class credit, once, forever.
create or replace function public.grant_signup_trial()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into class_credits (client_id, player_id, type, source, note)
  values (new.client_id, new.id, 'group_trial', 'signup', 'Free trial class')
  on conflict (player_id) where (type = 'group_trial') do nothing;
  return new;
end;
$function$;

drop trigger if exists players_grant_trial on public.players;
create trigger players_grant_trial
  after insert on public.players
  for each row execute function public.grant_signup_trial();

-- ── 6) booking RPCs: subscription OR credit ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.book_session(p_session uuid, p_player uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_capacity int;
  v_confirmed int;
  v_cap int;
  v_used int;
  v_booking bookings%rowtype;
  v_position int;
  v_credit uuid := null;
  v_cutoff int := get_setting_int('booking_cutoff_minutes', 60);
begin
  if v_client is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_session from class_sessions where id = p_session for update;
  if not found then raise exception 'session_not_found'; end if;

  select * into v_class from classes where id = v_session.class_id;

  if v_session.status <> 'scheduled'
     or v_session.starts_at <= now() + make_interval(mins => v_cutoff) then
    raise exception 'session_not_bookable';
  end if;

  if not exists (select 1 from players where id = p_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  -- Entitlement: a group subscription, else consume a trial/drop-in credit.
  if not has_group_subscription(v_client) then
    v_credit := _consume_group_credit(v_client, p_player);  -- raises no_entitlement
  end if;

  -- Weekly cap (ISO week of the session, in class timezone) — subscription only
  select p.group_sessions_per_week into v_cap
  from subscriptions s join plans p on p.id = s.plan_id
  where s.client_id = v_client
    and s.status in ('active', 'trialing', 'past_due')
    and (p.group_sessions_per_week is null or p.group_sessions_per_week > 0)
  order by s.created_at desc limit 1;

  if v_credit is null and v_cap is not null then
    select count(*) into v_used
    from bookings b
    join class_sessions cs on cs.id = b.session_id
    join classes c on c.id = cs.class_id
    where b.client_id = v_client
      and b.status = 'confirmed'
      and c.class_type = 'group'
      and date_trunc('week', cs.starts_at at time zone 'Asia/Kolkata')
        = date_trunc('week', v_session.starts_at at time zone 'Asia/Kolkata');
    if v_used >= v_cap then
      raise exception 'weekly_cap_reached';
    end if;
  end if;

  -- No overlapping confirmed booking for the same player (A2)
  if exists (
    select 1 from bookings b
    join class_sessions cs on cs.id = b.session_id
    where b.player_id = p_player
      and b.status = 'confirmed'
      and tstzrange(cs.starts_at, cs.ends_at) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then
    raise exception 'player_double_booked';
  end if;

  v_capacity := coalesce(v_session.capacity_override, v_class.capacity);
  select count(*) into v_confirmed
  from bookings where session_id = p_session and status = 'confirmed';

  if v_confirmed < v_capacity then
    insert into bookings (session_id, client_id, player_id, status)
    values (p_session, v_client, p_player, 'confirmed')
    returning * into v_booking;

    -- confirmation + reminders (P11 delivers)
    insert into notifications (user_id, type, title, body, data, scheduled_for) values
      (v_client, 'booking_confirmed', 'Booked.',
       to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI am') || ' — ' || v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
       now()),
      (v_client, 'reminder_24h', 'Tomorrow', v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
       v_session.starts_at - interval '24 hours'),
      (v_client, 'reminder_2h', 'Later today', v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
       v_session.starts_at - interval '2 hours');
  else
    select coalesce(max(waitlist_position), 0) + 1 into v_position
    from bookings where session_id = p_session and status = 'waitlisted';

    insert into bookings (session_id, client_id, player_id, status, waitlist_position)
    values (p_session, v_client, p_player, 'waitlisted', v_position)
    returning * into v_booking;

    raise notice 'session_full_waitlisted';
  end if;

  if v_credit is not null then
    update class_credits set booking_id = v_booking.id where id = v_credit;
  end if;

  return v_booking;
exception
  when unique_violation then
    raise exception 'already_booked';
end;
$function$;

CREATE OR REPLACE FUNCTION public.book_series(p_session uuid, p_player uuid, p_recurring boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_tz text;
  v_weekday int; v_time time;
  v_series uuid := null;
  v_status text;
  v_first text := null;
  v_confirmed int := 0; v_waitlisted int := 0; v_skipped int := 0;
  v_booking bookings%rowtype;
  r record;
begin
  if v_client is null then raise exception 'not_authenticated'; end if;

  select * into v_session from class_sessions where id = p_session;
  if not found then raise exception 'session_not_found'; end if;
  select * into v_class from classes where id = v_session.class_id;
  v_tz := coalesce(v_class.timezone, 'Asia/Kolkata');

  if not exists (select 1 from players where id = p_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  -- No group subscription: a single session can ride on a trial/drop-in credit
  -- (book_session consumes it); a recurring series needs a membership.
  if not has_group_subscription(v_client) then
    if p_recurring then
      raise exception 'recurring_needs_membership';
    end if;
    v_booking := book_session(p_session, p_player);
    return jsonb_build_object(
      'series_id', null,
      'confirmed', case when v_booking.status = 'confirmed' then 1 else 0 end,
      'waitlisted', case when v_booking.status = 'waitlisted' then 1 else 0 end,
      'skipped', 0,
      'first_status', v_booking.status::text);
  end if;

  v_weekday := extract(isodow from (v_session.starts_at at time zone v_tz))::int;
  v_time := (v_session.starts_at at time zone v_tz)::time;

  if p_recurring then
    -- reuse an existing active series for this slot, else create one
    select id into v_series from booking_series
    where player_id = p_player and class_id = v_session.class_id
      and weekday = v_weekday and start_time = v_time and active;
    if v_series is null then
      insert into booking_series (client_id, player_id, class_id, weekday, start_time)
      values (v_client, p_player, v_session.class_id, v_weekday, v_time)
      returning id into v_series;
    end if;

    -- enrol every future occurrence of this slot, nearest first (notify only the first)
    for r in
      select s.id, s.starts_at from class_sessions s
      where s.class_id = v_session.class_id and s.status = 'scheduled'
        and s.starts_at > now()
        and extract(isodow from (s.starts_at at time zone v_tz))::int = v_weekday
        and (s.starts_at at time zone v_tz)::time = v_time
      order by s.starts_at
    loop
      v_status := _book_one(r.id, v_client, p_player, v_series, v_first is null);
      if v_first is null then v_first := v_status; end if;
      if v_status = 'confirmed' then v_confirmed := v_confirmed + 1;
      elsif v_status = 'waitlisted' then v_waitlisted := v_waitlisted + 1;
      else v_skipped := v_skipped + 1; end if;
    end loop;
  else
    v_status := _book_one(p_session, v_client, p_player, null, true);
    v_first := v_status;
    if v_status = 'confirmed' then v_confirmed := 1;
    elsif v_status = 'waitlisted' then v_waitlisted := 1;
    else v_skipped := 1; end if;
  end if;

  return jsonb_build_object(
    'series_id', v_series, 'confirmed', v_confirmed,
    'waitlisted', v_waitlisted, 'skipped', v_skipped, 'first_status', v_first);
end;
$function$;

-- ── 7) private booking: minutes balance is the only gate ─────────────────────

CREATE OR REPLACE FUNCTION public.request_private_class(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_player uuid := (payload->>'player_id')::uuid;
  v_duration int := (payload->>'duration_minutes')::int;
  v_start timestamptz := (payload->>'starts_at')::timestamptz;
  v_preferred uuid := nullif(payload->>'preferred_coach', '')::uuid;
  v_class_id uuid;
  v_session_id uuid;
  v_booking bookings%rowtype;
  v_coach uuid;
  v_balance int;
begin
  if v_client is null then raise exception 'not_authenticated'; end if;

  -- Minutes are the entitlement: they arrive from a private plan's monthly
  -- grant or a one-off purchase. No subscription requirement.
  v_balance := private_minutes_balance(v_client);
  if v_balance < v_duration then raise exception 'insufficient_minutes'; end if;

  if not exists (select 1 from players where id = v_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  if v_start < now() + interval '24 hours' then
    raise exception 'lead_time_24h';
  end if;

  insert into classes (class_type, title, skill_level, capacity, duration_minutes, starts_on, created_by)
  values ('private', 'Private session', 'beginner', 1, v_duration, (v_start at time zone 'Asia/Kolkata')::date, v_client)
  returning id into v_class_id;

  insert into private_class_details (class_id, client_id, player_id, address, postcode, lat, lng, has_table, access_notes, address_details)
  values (
    v_class_id, v_client, v_player,
    payload->>'address', coalesce(payload->>'postcode', ''),
    (payload->>'lat')::float8, (payload->>'lng')::float8,
    coalesce((payload->>'has_table')::boolean, true),
    payload->>'access_notes',
    payload->'address_details'
  );

  insert into class_sessions (class_id, starts_at, ends_at)
  values (v_class_id, v_start, v_start + make_interval(mins => v_duration))
  returning id into v_session_id;

  v_coach := assign_coach(v_session_id, v_preferred);

  -- Debit stands even if parked (refund only if founder cancels).
  insert into private_credit_ledger (client_id, delta_minutes, reason)
  values (v_client, -v_duration, 'booking');

  insert into bookings (session_id, client_id, player_id, status)
  values (v_session_id, v_client, v_player, 'confirmed')
  returning * into v_booking;

  if v_coach is not null then
    insert into notifications (user_id, type, title, body, data) values
      (v_client, 'coach_assigned', 'You''re on.',
       'Coach confirmed for ' || to_char(v_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am') || '.',
       jsonb_build_object('session_id', v_session_id, 'coach_id', v_coach, 'url', '/app/schedule')),
      (v_coach, 'new_private_session', 'New private session',
       to_char(v_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am') || ' — ' || (payload->>'address'),
       jsonb_build_object('session_id', v_session_id, 'url', '/coach/session/' || v_session_id));
  else
    insert into notifications (user_id, type, title, body, data)
    select p.id, 'private_request_parked', 'Private request parked',
           'A private request has no available coach — resolve manually.',
           jsonb_build_object('session_id', v_session_id, 'url', '/admin/calendar')
    from profiles p where p.role = 'founder';

    insert into notifications (user_id, type, title, body, data)
    values (v_client, 'coach_assigned', 'We''re confirming your coach',
            'You''ll hear from us within 24 hours.',
            jsonb_build_object('session_id', v_session_id, 'url', '/app/schedule'));
  end if;

  return v_session_id;
end;
$function$;

-- ── 8) cancel_booking: also hand back class credits when in-window ───────────

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_booking bookings%rowtype;
  v_session class_sessions%rowtype;
  v_window int := get_setting_int('cancellation_window_hours', 24);
  v_free boolean;
  v_next bookings%rowtype;
  v_is_private boolean;
  v_duration int;
begin
  select * into v_booking from bookings where id = p_booking for update;
  if not found or (v_booking.client_id <> v_client and not is_founder()) then
    raise exception 'booking_not_found';
  end if;
  if v_booking.status not in ('confirmed', 'waitlisted') then
    raise exception 'booking_not_live';
  end if;

  select * into v_session from class_sessions where id = v_booking.session_id for update;
  v_free := v_session.starts_at >= now() + make_interval(hours => v_window);

  update bookings
  set status = 'cancelled_by_client',
      cancelled_at = now(),
      cancel_reason = case when v_free then 'in_window' else 'late' end
  where id = p_booking;

  -- Private sessions: refund minutes when in-window (P07)
  select c.class_type = 'private', c.duration_minutes into v_is_private, v_duration
  from classes c where c.id = v_session.class_id;

  if v_is_private and v_free then
    insert into private_credit_ledger (client_id, booking_id, delta_minutes, reason)
    values (v_booking.client_id, p_booking, v_duration, 'cancellation_refund');
  end if;

  -- Group credit (trial / drop-in): hand it back when cancelled in-window.
  if v_free then
    update class_credits
    set consumed_at = null, booking_id = null
    where booking_id = p_booking;
  end if;

  -- Offer-based waitlist promotion (A3): notify position 1, don't auto-confirm.
  if v_booking.status = 'confirmed' then
    select * into v_next
    from bookings
    where session_id = v_booking.session_id and status = 'waitlisted'
    order by waitlist_position asc limit 1;

    if found then
      insert into notifications (user_id, type, title, body, data, scheduled_for)
      values (v_next.client_id, 'waitlist_spot', 'A spot opened',
        'Claim it within ' || get_setting_int('waitlist_claim_minutes', 15) || ' minutes.',
        jsonb_build_object('booking_id', v_next.id, 'session_id', v_booking.session_id,
                           'claim_by', now() + make_interval(mins => get_setting_int('waitlist_claim_minutes', 15)),
                           'url', '/app/book/class/' || v_booking.session_id),
        now());
    end if;
  end if;

  -- Sweep pending reminders for this booking (P11 hygiene, done inline here)
  delete from notifications
  where status = 'pending'
    and (data->>'booking_id')::uuid = p_booking
    and type in ('reminder_24h', 'reminder_2h');
end;
$function$;

-- ── 9) RLS ───────────────────────────────────────────────────────────────────
alter table public.class_credits enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;

create policy "own credits" on public.class_credits
  for select using (client_id = auth.uid() or is_founder());
create policy "founder writes credits" on public.class_credits
  for all using (is_founder());

create policy "anyone reads active products" on public.products
  for select using (active = true or is_founder());
create policy "founder writes products" on public.products
  for all using (is_founder());

create policy "own orders" on public.orders
  for select using (client_id = auth.uid() or is_founder());
create policy "founder writes orders" on public.orders
  for all using (is_founder());
