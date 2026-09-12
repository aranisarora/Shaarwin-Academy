-- 0012 — Recurring group bookings ("book every Monday 17:00 at venue X").
--
-- Model: a class (batch) already recurs on one or more weekdays. A CLIENT,
-- however, books a single weekday-slot within that batch. `booking_series`
-- is that standing reservation, keyed by (class, weekday, wall-clock time,
-- player). Booking a series enrols every *future* occurrence of that slot;
-- the session generator (0009) is taught to enrol newly-materialised weeks
-- too, so the standing booking rolls forward indefinitely.
--
-- Reschedule respects the calendar-app split: "this occurrence only" is the
-- existing single-session move (leaves the series intact); "this + following"
-- re-points the whole series (reschedule_series below).

-- ── 1. Standing reservation ──────────────────────────────────────────────────
create table if not exists booking_series (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references profiles(id),
  player_id    uuid not null references players(id) on delete cascade,
  class_id     uuid not null references classes(id) on delete cascade,
  weekday      int  not null check (weekday between 1 and 7),  -- ISO dow (Mon=1)
  start_time   time not null,                                  -- wall clock, class tz
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz
);

-- At most one live standing booking per player for a given class-slot.
create unique index if not exists booking_series_one_active
  on booking_series (player_id, class_id, weekday, start_time)
  where active;

create index if not exists booking_series_active_class
  on booking_series (class_id) where active;

alter table bookings add column if not exists series_id uuid references booking_series(id);
create index if not exists bookings_series_id on bookings (series_id) where series_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table booking_series enable row level security;

drop policy if exists "clients read own series" on booking_series;
create policy "clients read own series" on booking_series
  for select using (client_id = auth.uid());

drop policy if exists "coaches read series on their sessions" on booking_series;
create policy "coaches read series on their sessions" on booking_series
  for select using (exists (
    select 1 from class_sessions s
    where s.class_id = booking_series.class_id and s.coach_id = auth.uid()
  ));

drop policy if exists "founder all series" on booking_series;
create policy "founder all series" on booking_series for all using (is_founder());
-- writes otherwise go only through the SECURITY DEFINER RPCs below.

-- ── 2. Per-occurrence booking helper ─────────────────────────────────────────
-- Books ONE session for a player, applying the same rules as book_session
-- (cutoff, weekly cap, double-book, capacity → waitlist). Returns a status
-- code; never raises for "expected" skips so a series loop can continue.
--   confirmed | waitlisted | skip_cutoff | skip_cap | skip_overlap | skip_dupe
create or replace function public._book_one(
  p_session uuid, p_client uuid, p_player uuid,
  p_series uuid default null, p_notify boolean default true
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_tz text;
  v_cutoff int := get_setting_int('booking_cutoff_minutes', 60);
  v_cap int; v_used int; v_capacity int; v_confirmed int; v_position int;
  v_booking bookings%rowtype;
begin
  select * into v_session from class_sessions where id = p_session for update;
  if not found then return 'skip_cutoff'; end if;
  select * into v_class from classes where id = v_session.class_id;
  v_tz := coalesce(v_class.timezone, 'Asia/Kolkata');

  if v_session.status <> 'scheduled'
     or v_session.starts_at <= now() + make_interval(mins => v_cutoff) then
    return 'skip_cutoff';
  end if;

  -- Weekly cap (group only), ISO week in the class timezone.
  select p.group_sessions_per_week into v_cap
  from subscriptions s join plans p on p.id = s.plan_id
  where s.client_id = p_client and s.status in ('active','trialing','past_due')
  order by s.created_at desc limit 1;

  if v_cap is not null and v_class.class_type = 'group' then
    select count(*) into v_used
    from bookings b
    join class_sessions cs on cs.id = b.session_id
    join classes c on c.id = cs.class_id
    where b.client_id = p_client and b.status = 'confirmed'
      and c.class_type = 'group'
      and date_trunc('week', cs.starts_at at time zone v_tz)
        = date_trunc('week', v_session.starts_at at time zone v_tz);
    if v_used >= v_cap then return 'skip_cap'; end if;
  end if;

  -- No overlapping confirmed booking for the same player.
  if exists (
    select 1 from bookings b
    join class_sessions cs on cs.id = b.session_id
    where b.player_id = p_player and b.status = 'confirmed'
      and tstzrange(cs.starts_at, cs.ends_at) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then
    return 'skip_overlap';
  end if;

  v_capacity := coalesce(v_session.capacity_override, v_class.capacity);
  select count(*) into v_confirmed from bookings
  where session_id = p_session and status = 'confirmed';

  begin
    if v_confirmed < v_capacity then
      insert into bookings (session_id, client_id, player_id, status, series_id)
      values (p_session, p_client, p_player, 'confirmed', p_series)
      returning * into v_booking;

      if p_notify then
        insert into notifications (user_id, type, title, body, data, scheduled_for) values
          (p_client, 'booking_confirmed', 'Booked.',
           to_char(v_session.starts_at at time zone v_tz, 'Dy DD Mon, HH24:MI') || ' — ' || v_class.title,
           jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
           now());
      end if;
      -- reminders always (each fires at its own session time)
      insert into notifications (user_id, type, title, body, data, scheduled_for) values
        (p_client, 'reminder_24h', 'Tomorrow', v_class.title,
         jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
         v_session.starts_at - interval '24 hours'),
        (p_client, 'reminder_2h', 'Later today', v_class.title,
         jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
         v_session.starts_at - interval '2 hours');
      return 'confirmed';
    else
      select coalesce(max(waitlist_position), 0) + 1 into v_position
      from bookings where session_id = p_session and status = 'waitlisted';
      insert into bookings (session_id, client_id, player_id, status, waitlist_position, series_id)
      values (p_session, p_client, p_player, 'waitlisted', v_position, p_series);
      return 'waitlisted';
    end if;
  exception when unique_violation then
    return 'skip_dupe';  -- already has a live booking on this session
  end;
end;
$$;

-- ── 3. Book a slot, optionally as a recurring series ─────────────────────────
-- p_recurring=false → books only p_session (single occurrence).
-- p_recurring=true  → creates/reuses a booking_series for p_session's slot and
--   enrols every future occurrence of that (class, weekday, time).
-- Returns { series_id, confirmed, waitlisted, skipped, first_status }.
create or replace function public.book_series(
  p_session uuid, p_player uuid, p_recurring boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  if not has_active_subscription(v_client) then
    raise exception 'no_active_subscription';
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
$$;

-- ── 4. Cancel a standing series ──────────────────────────────────────────────
-- Deactivates the series and cancels its FUTURE live bookings (past/attended
-- rows are untouched). Waitlist promotion mirrors cancel_booking's offer model.
create or replace function public.cancel_series(p_series uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := auth.uid();
  v_series booking_series%rowtype;
  v_count int := 0;
  r record;
begin
  select * into v_series from booking_series where id = p_series;
  if not found or (v_series.client_id <> v_client and not is_founder()) then
    raise exception 'series_not_found';
  end if;

  for r in
    select b.id, b.session_id from bookings b
    join class_sessions s on s.id = b.session_id
    where b.series_id = p_series and b.status in ('confirmed','waitlisted')
      and s.starts_at > now()
  loop
    update bookings set status = 'cancelled_by_client', cancelled_at = now(),
      cancel_reason = 'series_cancelled'
    where id = r.id;
    v_count := v_count + 1;

    -- offer the freed seat to the head of the waitlist
    insert into notifications (user_id, type, title, body, data, scheduled_for)
    select b.client_id, 'waitlist_spot', 'A spot opened',
      'Claim it within ' || get_setting_int('waitlist_claim_minutes', 15) || ' minutes.',
      jsonb_build_object('booking_id', b.id, 'session_id', r.session_id,
        'url', '/app/book/class/' || r.session_id), now()
    from bookings b
    where b.session_id = r.session_id and b.status = 'waitlisted'
    order by b.waitlist_position asc limit 1;

    delete from notifications where status = 'pending'
      and (data->>'booking_id')::uuid = r.id
      and type in ('reminder_24h','reminder_2h');
  end loop;

  update booking_series set active = false, cancelled_at = now() where id = p_series;
  return v_count;
end;
$$;

-- ── 5. Reschedule "this + following" ─────────────────────────────────────────
-- Moves the picked occurrence to p_target_session AND re-points the standing
-- booking to the target's slot: the old series is cancelled (future weeks
-- freed) and a fresh series is booked forward on the new slot. The immediate
-- move reuses the reschedule chain so hop limits / .ics regen still apply.
create or replace function public.reschedule_series(p_booking uuid, p_target_session uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := auth.uid();
  v_booking bookings%rowtype;
  v_result bookings%rowtype;
  v_target class_sessions%rowtype;
  v_new jsonb;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found or v_booking.client_id <> v_client then raise exception 'booking_not_found'; end if;

  -- 1) move this week via the existing atomic single-move (validates target/hops)
  v_result := reschedule_booking(p_booking, p_target_session);

  -- 2) tear down the old standing series (frees other future weeks)
  if v_booking.series_id is not null then
    perform cancel_series(v_booking.series_id);
  end if;

  -- 3) stand up a new series on the target slot and enrol its future weeks.
  --    The immediate target week is already booked by step 1; book_series will
  --    skip it as a duplicate and enrol the remaining future occurrences.
  select * into v_target from class_sessions where id = p_target_session;
  v_new := book_series(p_target_session, v_booking.player_id, true);

  return jsonb_build_object('moved_booking', v_result.id, 'series', v_new);
end;
$$;

-- ── 6. Auto-enrol active series into newly generated sessions ────────────────
-- The generator materialises future weeks; after inserting, book any active
-- series whose slot matches the new session so "every Monday" never lapses.
create or replace function public.generate_class_sessions(p_weeks int default 8)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  d date;
  v_days text[];
  v_start timestamptz;
  v_count int := 0;
  v_time time;
  v_tz text;
  v_session_id uuid;
  s record;
begin
  for r in
    select c.*, (select s.starts_at from class_sessions s where s.class_id = c.id
                 order by s.starts_at limit 1) as first_start
    from classes c where c.class_type = 'group' and c.active
      and c.recurrence_rule like 'FREQ=WEEKLY%'
  loop
    v_tz := coalesce(r.timezone, 'Asia/Kolkata');
    v_days := string_to_array(substring(r.recurrence_rule from 'BYDAY=([A-Z,]+)'), ',');
    v_time := coalesce((r.first_start at time zone v_tz)::time, time '18:30');
    for d in select generate_series(current_date, current_date + p_weeks * 7, interval '1 day')::date loop
      exit when r.ends_on is not null and d > r.ends_on;
      if (array['MO','TU','WE','TH','FR','SA','SU'])[extract(isodow from d)::int] = any (v_days) then
        v_start := (d::text || ' ' || v_time::text)::timestamp at time zone v_tz;
        if v_start > now() and not exists (
          select 1 from class_sessions cs where cs.class_id = r.id and cs.starts_at = v_start
        ) then
          insert into class_sessions (class_id, starts_at, ends_at)
          values (r.id, v_start, v_start + make_interval(mins => r.duration_minutes))
          returning id into v_session_id;
          v_count := v_count + 1;

          -- enrol standing series that match this brand-new occurrence
          for s in
            select bs.id as series_id, bs.client_id, bs.player_id
            from booking_series bs
            where bs.active and bs.class_id = r.id
              and bs.weekday = extract(isodow from d)::int
              and bs.start_time = v_time
          loop
            perform _book_one(v_session_id, s.client_id, s.player_id, s.series_id, false);
          end loop;
        end if;
      end if;
    end loop;
  end loop;
  perform assign_unassigned_sessions();
  return v_count;
end;
$$;
