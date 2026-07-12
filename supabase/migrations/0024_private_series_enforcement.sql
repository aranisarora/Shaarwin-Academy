-- Private plan enforcement + recurring weekly private sessions.
--
-- 1. Plans gain explicit private limits: sessions per week + session length.
--    NULL on both = legacy minutes-only behaviour (top-ups, comps) unchanged.
-- 2. private_booking_series: a standing weekly private slot per player
--    (weekday + IST wall-clock time + address payload). Unlike group
--    booking_series it cannot hang off a class_id — every private occurrence
--    creates its own classes row — so it carries the full request payload.
-- 3. _create_private_occurrence: shared path for one-off requests, series
--    creation and the nightly generator (class + details + session +
--    assign_coach + ledger debit + booking + notifications).
-- 4. generate_private_sessions(4): nightly pg_cron job rolls the horizon,
--    retires series whose private plan lapsed, skips weeks with insufficient
--    minutes (resumes after renewal grant).

-- ── Plan limit columns ───────────────────────────────────────────────────────
alter table public.plans
  -- null = legacy minutes-only (no weekly cap)
  add column if not exists private_sessions_per_week integer,
  -- null = free 60/90 choice; set = every private session must be this length
  add column if not exists private_session_minutes integer;

-- ── Standing weekly private slot ─────────────────────────────────────────────
create table public.private_booking_series (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  player_id uuid not null,
  preferred_coach uuid,
  weekday integer not null,          -- ISO 1..7, Asia/Kolkata wall clock
  start_time time not null,          -- IST wall clock
  duration_minutes integer not null,
  address text not null,
  postcode text default '' not null,
  lat float8 not null,
  lng float8 not null,
  has_table boolean default true not null,
  access_notes text,
  address_details jsonb,
  active boolean default true not null,
  created_at timestamptz default now() not null,
  cancelled_at timestamptz
);

alter table public.private_booking_series
  add constraint private_booking_series_pkey primary key (id);
alter table public.private_booking_series
  add constraint private_booking_series_client_id_fkey foreign key (client_id) references profiles(id) on delete cascade;
alter table public.private_booking_series
  add constraint private_booking_series_player_id_fkey foreign key (player_id) references players(id) on delete cascade;
alter table public.private_booking_series
  add constraint private_booking_series_preferred_coach_fkey foreign key (preferred_coach) references coaches(id) on delete set null;
alter table public.private_booking_series
  add constraint private_booking_series_weekday_check check (weekday >= 1 and weekday <= 7);

create index private_booking_series_client_active
  on public.private_booking_series (client_id) where active;
create unique index private_booking_series_one_active
  on public.private_booking_series (player_id, weekday, start_time) where active;

-- bookings.series_id has an FK to booking_series, so private occurrences get
-- their own pointer.
alter table public.bookings add column if not exists private_series_id uuid;
alter table public.bookings
  add constraint bookings_private_series_id_fkey foreign key (private_series_id) references private_booking_series(id) on delete set null;
create index bookings_private_series_id
  on public.bookings (private_series_id) where private_series_id is not null;

alter table public.private_booking_series enable row level security;
create policy "clients read own private series" on public.private_booking_series
  for select using (client_id = auth.uid());
create policy "founder all private series" on public.private_booking_series
  for all using (is_founder());

-- ── Plan limit helpers ───────────────────────────────────────────────────────

-- The caller's alive *private* plan (not just the latest subscription — a
-- client can hold a group plan too). Zero rows = no private plan.
create or replace function public.private_plan_limits(p_client uuid)
returns table(sessions_per_week integer, session_minutes integer)
language sql stable security definer set search_path to 'public'
as $$
  select p.private_sessions_per_week, p.private_session_minutes
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.client_id = p_client
    and (coalesce(p.private_minutes_per_cycle, 0) > 0
         or p.private_sessions_per_week is not null
         or p.private_session_minutes is not null)
    and (
      s.status in ('active', 'trialing')
      or (
        s.status = 'past_due'
        and s.current_period_end is not null
        and now() <= s.current_period_end
            + make_interval(days => get_setting_int('dunning_grace_days', 7))
      )
    )
  order by s.created_at desc
  limit 1;
$$;

-- Enforce the private plan at booking time. Legacy (no private plan, or both
-- columns null) keeps today's minutes-only behaviour.
create or replace function public._assert_private_plan_allows(p_client uuid, p_start timestamptz, p_duration integer)
returns void
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_spw int; v_mins int; v_used int;
begin
  select sessions_per_week, session_minutes into v_spw, v_mins
  from private_plan_limits(p_client);

  if v_mins is not null and p_duration <> v_mins then
    raise exception 'plan_duration_mismatch';
  end if;

  if v_spw is not null then
    select count(*) into v_used
    from bookings b
    join class_sessions cs on cs.id = b.session_id
    join classes c on c.id = cs.class_id
    where b.client_id = p_client and b.status = 'confirmed'
      and c.class_type = 'private'
      and date_trunc('week', cs.starts_at at time zone 'Asia/Kolkata')
        = date_trunc('week', p_start at time zone 'Asia/Kolkata');
    if v_used >= v_spw then
      raise exception 'private_weekly_cap';
    end if;
  end if;
end;
$$;

-- ── Shared occurrence creation ───────────────────────────────────────────────
-- Body extracted from request_private_class so the one-off RPC, series
-- creation and the nightly generator share one code path. p_notify=false
-- keeps client chatter down for bulk-generated weeks (coach/founder are
-- always told).
create or replace function public._create_private_occurrence(
  p_client uuid, p_player uuid, p_start timestamptz, p_duration integer,
  p_address text, p_postcode text, p_lat float8, p_lng float8,
  p_has_table boolean, p_access_notes text, p_address_details jsonb,
  p_preferred uuid default null, p_series uuid default null, p_notify boolean default true
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_class_id uuid;
  v_session_id uuid;
  v_booking bookings%rowtype;
  v_coach uuid;
begin
  -- Minutes are the entitlement: they arrive from a private plan's monthly
  -- grant or a one-off purchase. No subscription requirement.
  if private_minutes_balance(p_client) < p_duration then
    raise exception 'insufficient_minutes';
  end if;

  perform _assert_private_plan_allows(p_client, p_start, p_duration);

  insert into classes (class_type, title, skill_level, capacity, duration_minutes, starts_on, created_by)
  values ('private', 'Private session', 'beginner', 1, p_duration, (p_start at time zone 'Asia/Kolkata')::date, p_client)
  returning id into v_class_id;

  insert into private_class_details (class_id, client_id, player_id, address, postcode, lat, lng, has_table, access_notes, address_details)
  values (v_class_id, p_client, p_player, p_address, coalesce(p_postcode, ''), p_lat, p_lng,
          coalesce(p_has_table, true), p_access_notes, p_address_details);

  insert into class_sessions (class_id, starts_at, ends_at)
  values (v_class_id, p_start, p_start + make_interval(mins => p_duration))
  returning id into v_session_id;

  v_coach := assign_coach(v_session_id, p_preferred);

  -- Debit stands even if parked (refund only if founder cancels).
  insert into private_credit_ledger (client_id, delta_minutes, reason)
  values (p_client, -p_duration, 'booking');

  insert into bookings (session_id, client_id, player_id, status, private_series_id)
  values (v_session_id, p_client, p_player, 'confirmed', p_series)
  returning * into v_booking;

  if v_coach is not null then
    if p_notify then
      insert into notifications (user_id, type, title, body, data)
      values (p_client, 'coach_assigned', 'You''re on.',
        'Coach confirmed for ' || to_char(p_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am') || '.',
        jsonb_build_object('session_id', v_session_id, 'coach_id', v_coach, 'url', '/app/schedule'));
    end if;
    insert into notifications (user_id, type, title, body, data)
    values (v_coach, 'new_private_session', 'New private session',
      to_char(p_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am') || ' — ' || p_address,
      jsonb_build_object('session_id', v_session_id, 'url', '/coach/session/' || v_session_id));
  else
    insert into notifications (user_id, type, title, body, data)
    select p.id, 'private_request_parked', 'Private request parked',
           'A private request has no available coach — resolve manually.',
           jsonb_build_object('session_id', v_session_id, 'url', '/admin/calendar')
    from profiles p where p.role = 'founder';

    if p_notify then
      insert into notifications (user_id, type, title, body, data)
      values (p_client, 'coach_assigned', 'We''re confirming your coach',
              'You''ll hear from us within 24 hours.',
              jsonb_build_object('session_id', v_session_id, 'url', '/app/schedule'));
    end if;
  end if;

  return v_session_id;
end;
$$;

-- ── One-off request now rides the shared path (and gains enforcement) ────────
create or replace function public.request_private_class(payload jsonb)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_client uuid := auth.uid();
  v_player uuid := (payload->>'player_id')::uuid;
  v_duration int := (payload->>'duration_minutes')::int;
  v_start timestamptz := (payload->>'starts_at')::timestamptz;
  v_preferred uuid := nullif(payload->>'preferred_coach', '')::uuid;
begin
  if v_client is null then raise exception 'not_authenticated'; end if;

  if not exists (select 1 from players where id = v_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  if v_start < now() + interval '24 hours' then
    raise exception 'lead_time_24h';
  end if;

  return _create_private_occurrence(
    v_client, v_player, v_start, v_duration,
    payload->>'address', coalesce(payload->>'postcode', ''),
    (payload->>'lat')::float8, (payload->>'lng')::float8,
    coalesce((payload->>'has_table')::boolean, true),
    payload->>'access_notes', payload->'address_details',
    v_preferred, nullif(payload->>'series_id', '')::uuid, true);
end;
$$;

-- ── Standing weekly slot(s) ──────────────────────────────────────────────────
-- payload: player_id, duration_minutes, address, postcode, lat, lng,
-- has_table, access_notes, address_details, preferred_coach,
-- starts_at_list (first occurrence of each weekly slot), weeks (default 4).
create or replace function public.create_private_series(payload jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_client uuid := auth.uid();
  v_player uuid := (payload->>'player_id')::uuid;
  v_duration int := (payload->>'duration_minutes')::int;
  v_preferred uuid := nullif(payload->>'preferred_coach', '')::uuid;
  v_weeks int := least(coalesce((payload->>'weeks')::int, 4), 8);
  v_spw int; v_mins int;
  v_active_series int;
  v_slots timestamptz[];
  v_first timestamptz;
  v_series uuid;
  v_series_ids uuid[] := '{}';
  v_booked int := 0;
  v_skipped int := 0;
  i int;
begin
  if v_client is null then raise exception 'not_authenticated'; end if;

  if not exists (select 1 from players where id = v_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  -- A standing series needs a private plan with a weekly frequency; legacy
  -- minutes-only clients keep one-off booking (mirrors
  -- recurring_needs_membership on the group side).
  select sessions_per_week, session_minutes into v_spw, v_mins
  from private_plan_limits(v_client);
  if v_spw is null then raise exception 'recurring_needs_private_plan'; end if;
  if v_mins is not null and v_duration <> v_mins then
    raise exception 'plan_duration_mismatch';
  end if;

  select array_agg(value::timestamptz) into v_slots
  from jsonb_array_elements_text(payload->'starts_at_list');
  if v_slots is null or array_length(v_slots, 1) = 0 then
    raise exception 'no_slots';
  end if;

  select count(*) into v_active_series
  from private_booking_series where client_id = v_client and active;
  if v_active_series + array_length(v_slots, 1) > v_spw then
    raise exception 'private_weekly_cap';
  end if;

  foreach v_first in array v_slots loop
    if v_first < now() + interval '24 hours' then
      raise exception 'lead_time_24h';
    end if;

    insert into private_booking_series (
      client_id, player_id, preferred_coach, weekday, start_time, duration_minutes,
      address, postcode, lat, lng, has_table, access_notes, address_details)
    values (
      v_client, v_player, v_preferred,
      extract(isodow from (v_first at time zone 'Asia/Kolkata'))::int,
      (v_first at time zone 'Asia/Kolkata')::time,
      v_duration,
      payload->>'address', coalesce(payload->>'postcode', ''),
      (payload->>'lat')::float8, (payload->>'lng')::float8,
      coalesce((payload->>'has_table')::boolean, true),
      payload->>'access_notes', payload->'address_details')
    returning id into v_series;
    v_series_ids := v_series_ids || v_series;

    -- IST has no DST, so +7 days keeps the wall-clock time stable.
    for i in 0..(v_weeks - 1) loop
      begin
        perform _create_private_occurrence(
          v_client, v_player, v_first + make_interval(days => 7 * i), v_duration,
          payload->>'address', coalesce(payload->>'postcode', ''),
          (payload->>'lat')::float8, (payload->>'lng')::float8,
          coalesce((payload->>'has_table')::boolean, true),
          payload->>'access_notes', payload->'address_details',
          v_preferred, v_series, i = 0);
        v_booked := v_booked + 1;
      exception when others then
        -- The first week must book (that's the promise the client tapped);
        -- later weeks may run out of minutes — the nightly generator picks
        -- them up after the renewal grant.
        if i = 0 then raise; end if;
        v_skipped := v_skipped + 1;
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'series_ids', to_jsonb(v_series_ids),
    'booked', v_booked, 'skipped', v_skipped);
end;
$$;

-- ── Nightly horizon roll (modeled on generate_class_sessions) ────────────────
create or replace function public.generate_private_sessions(p_weeks integer default 4)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  r record;
  d date;
  v_start timestamptz;
  v_count int := 0;
begin
  for r in select * from private_booking_series where active loop
    -- Plan lapsed → retire the series (auto-renew is implicit: it keeps
    -- generating for as long as the subscription stays alive).
    if (select sessions_per_week from private_plan_limits(r.client_id)) is null then
      update private_booking_series set active = false, cancelled_at = now() where id = r.id;
      insert into notifications (user_id, type, title, body, data)
      values (r.client_id, 'private_series_ended', 'Weekly sessions ended',
        'Your weekly private slot ended with your plan. Renew to keep the slot.',
        jsonb_build_object('series_id', r.id, 'url', '/app/billing'));
      continue;
    end if;

    for d in select generate_series(current_date, current_date + p_weeks * 7, interval '1 day')::date loop
      if extract(isodow from d)::int = r.weekday then
        v_start := (d::text || ' ' || r.start_time::text)::timestamp at time zone 'Asia/Kolkata';
        -- A booking of ANY status blocks regeneration: a cancelled week must
        -- not resurrect.
        if v_start > now() + interval '24 hours' and not exists (
          select 1 from bookings b
          join class_sessions cs on cs.id = b.session_id
          where b.private_series_id = r.id and cs.starts_at = v_start
        ) then
          begin
            perform _create_private_occurrence(
              r.client_id, r.player_id, v_start, r.duration_minutes,
              r.address, r.postcode, r.lat, r.lng, r.has_table,
              r.access_notes, r.address_details,
              r.preferred_coach, r.id, false);
            v_count := v_count + 1;
          exception when others then
            if sqlerrm = 'insufficient_minutes'
               and v_start < now() + interval '8 days'
               and not exists (
                 select 1 from notifications
                 where user_id = r.client_id and type = 'private_minutes_low'
                   and data->>'series_id' = r.id::text
                   and created_at > now() - interval '3 days'
               ) then
              insert into notifications (user_id, type, title, body, data)
              values (r.client_id, 'private_minutes_low', 'Weekly session paused',
                'Not enough private minutes to book your next weekly session — it resumes when your plan renews.',
                jsonb_build_object('series_id', r.id, 'url', '/app/billing'));
              perform notify_founders('ops_private_series_paused', 'Private series paused',
                'A weekly private slot could not be booked (insufficient minutes).',
                jsonb_build_object('series_id', r.id, 'client_id', r.client_id, 'url', '/admin/billing'));
            end if;
            -- other skips (weekly cap from a one-off booking, etc.) stay silent
          end;
        end if;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- ── End a standing slot ──────────────────────────────────────────────────────
create or replace function public.cancel_private_series(p_series uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_client uuid := auth.uid();
  v_series private_booking_series%rowtype;
  r record;
  v_count int := 0;
begin
  select * into v_series from private_booking_series where id = p_series;
  if not found or (v_series.client_id <> v_client and not is_founder()) then
    raise exception 'series_not_found';
  end if;

  for r in
    select b.id from bookings b
    join class_sessions cs on cs.id = b.session_id
    where b.private_series_id = p_series
      and b.status in ('confirmed', 'waitlisted')
      and cs.starts_at > now()
  loop
    perform cancel_booking(r.id);  -- handles in-window refund + session teardown
    v_count := v_count + 1;
  end loop;

  update private_booking_series set active = false, cancelled_at = now()
  where id = p_series;
  return v_count;
end;
$$;

-- ── cancel_booking: tear down the private session too ────────────────────────
-- A private class has capacity 1; cancelling its only booking must cancel the
-- session (else it lingers on the coach calendar) and tell the coach.
create or replace function public.cancel_booking(p_booking uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
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

  -- Private sessions have exactly one booking: cancel the session itself so it
  -- doesn't linger on the coach calendar, and tell the coach.
  if v_is_private then
    update class_sessions
    set status = 'cancelled', cancel_reason = 'client_cancelled'
    where id = v_session.id and status = 'scheduled';
    if v_session.coach_id is not null then
      insert into notifications (user_id, type, title, body, data)
      values (v_session.coach_id, 'session_cancelled', 'Private session cancelled',
        'The ' || to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am')
        || ' private session was cancelled by the client.',
        jsonb_build_object('session_id', v_session.id, 'url', '/coach/calendar'));
    end if;
  end if;

  -- Group credit (trial / drop-in): hand it back when cancelled in-window.
  if v_free then
    update class_credits
    set consumed_at = null, booking_id = null
    where booking_id = p_booking;
  end if;

  -- Offer-based waitlist promotion (A3): notify position 1, don't auto-confirm.
  if not v_is_private and v_booking.status = 'confirmed' then
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
$$;

-- ── Nightly roll ─────────────────────────────────────────────────────────────
-- 21:40 UTC = 03:10 IST; runs before the day starts in Bengaluru.
select cron.schedule('private-series-nightly', '40 21 * * *',
  $$select public.generate_private_sessions(4)$$);
