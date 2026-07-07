-- 0007: academy moved to Asia/Kolkata — recreate every function that
-- interprets wall-clock time (availability windows, session generation,
-- notification copy) with the new timezone. Bodies are verbatim copies of
-- their latest prior definitions with only the timezone string changed.

-- from 0003_booking_rpcs.sql
create or replace function public.book_session(p_session uuid, p_player uuid)
returns bookings
language plpgsql security definer set search_path = public as $$
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

  if not has_active_subscription(v_client) then
    raise exception 'no_active_subscription';
  end if;

  -- Weekly cap (ISO week of the session, in class timezone)
  select p.group_sessions_per_week into v_cap
  from subscriptions s join plans p on p.id = s.plan_id
  where s.client_id = v_client
    and s.status in ('active', 'trialing', 'past_due')
  order by s.created_at desc limit 1;

  if v_cap is not null then
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
       to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH24:MI') || ' — ' || v_class.title,
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

  return v_booking;
exception
  when unique_violation then
    raise exception 'already_booked';
end;
$$;

-- from 0004_assignment_engine.sql
create or replace function public.coach_filter_failure(
  p_coach uuid, p_session uuid
) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_coach coaches%rowtype;
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_lat float8; v_lng float8;
  v_buffer int := get_setting_int('travel_buffer_minutes', 30);
  v_wd smallint;
  v_start time; v_end time;
  v_has_junior boolean;
begin
  select * into v_coach from coaches where id = p_coach and active;
  if not found then return 'inactive'; end if;

  select * into v_session from class_sessions where id = p_session;
  select * into v_class from classes where id = v_session.class_id;

  -- 1. time off
  if exists (
    select 1 from coach_time_off t
    where t.coach_id = p_coach and t.status = 'approved'
      and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then return 'time_off'; end if;

  -- 2. availability window (Asia/Kolkata wall clock, weekday 0=Mon)
  v_wd := ((extract(isodow from v_session.starts_at at time zone 'Asia/Kolkata'))::int - 1);
  v_start := (v_session.starts_at at time zone 'Asia/Kolkata')::time;
  v_end := (v_session.ends_at at time zone 'Asia/Kolkata')::time;
  if not exists (
    select 1 from coach_availability a
    where a.coach_id = p_coach and a.weekday = v_wd
      and a.start_time <= v_start and a.end_time >= v_end
  ) then return 'unavailable'; end if;

  -- 3. overlap incl. travel buffer at different locations
  if exists (
    select 1 from class_sessions s2
    join classes c2 on c2.id = s2.class_id
    where s2.coach_id = p_coach and s2.status = 'scheduled' and s2.id <> p_session
      and tstzrange(
            s2.starts_at - case when c2.venue_id is distinct from v_class.venue_id
                                then make_interval(mins => v_buffer) else interval '0' end,
            s2.ends_at + case when c2.venue_id is distinct from v_class.venue_id
                              then make_interval(mins => v_buffer) else interval '0' end
          ) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then return 'overlap'; end if;

  -- 4. radius for private sessions
  if v_class.class_type = 'private' then
    select d.lat, d.lng into v_lat, v_lng
    from private_class_details d where d.class_id = v_class.id;
    if haversine_km(v_lat, v_lng, v_coach.base_lat, v_coach.base_lng) > v_coach.travel_radius_km then
      return 'out_of_radius';
    end if;
  end if;

  -- 5. level ceiling
  if v_class.skill_level > v_coach.max_teachable_level then
    return 'level_too_high';
  end if;

  -- 6. safeguarding: junior in the room requires DBS
  select exists (
    select 1 from bookings b
    join players pl on pl.id = b.player_id
    where b.session_id = p_session
      and b.status in ('confirmed', 'waitlisted')
      and pl.date_of_birth is not null
      and pl.date_of_birth > (current_date - interval '18 years')
    union
    select 1 from private_class_details d
    join players pl on pl.id = d.player_id
    where d.class_id = v_class.id
      and pl.date_of_birth is not null
      and pl.date_of_birth > (current_date - interval '18 years')
  ) into v_has_junior;
  if v_has_junior and not v_coach.dbs_checked then
    return 'dbs_required';
  end if;

  return null;
end;
$$;

-- from 0004_assignment_engine.sql
create or replace function public.rank_coaches(p_session uuid, p_preferred uuid default null)
returns table (coach_id uuid, score numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_weights jsonb;
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_lat float8; v_lng float8;
begin
  select coalesce(
    (select value from settings where key = 'assignment_weights'),
    '{"continuity":35,"proximity":25,"load":20,"adjacency":15,"seniority":5}'::jsonb
  ) into v_weights;

  select * into v_session from class_sessions where id = p_session;
  select * into v_class from classes where id = v_session.class_id;

  if v_class.class_type = 'private' then
    select d.lat, d.lng into v_lat, v_lng from private_class_details d where d.class_id = v_class.id;
  else
    select v.lat, v.lng into v_lat, v_lng from venues v where v.id = v_class.venue_id;
  end if;

  return query
  with pool as (
    select c.* from coaches c
    where c.active and coach_filter_failure(c.id, p_session) is null
  ),
  metrics as (
    select
      c.id,
      -- continuity: coached this class (group) or this client (private) before
      (case when v_class.class_type = 'group' then exists (
          select 1 from class_sessions s where s.class_id = v_class.id
            and s.coach_id = c.id and s.id <> p_session)
        else exists (
          select 1 from class_sessions s
          join classes c2 on c2.id = s.class_id
          join private_class_details d on d.class_id = c2.id
          where s.coach_id = c.id
            and d.client_id = (select client_id from private_class_details where class_id = v_class.id))
      end)::int as continuity,
      haversine_km(v_lat, v_lng, c.base_lat, c.base_lng) as dist,
      coalesce((
        select sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600.0)
        from class_sessions s
        where s.coach_id = c.id and s.status = 'scheduled'
          and date_trunc('week', s.starts_at at time zone 'Asia/Kolkata')
            = date_trunc('week', v_session.starts_at at time zone 'Asia/Kolkata')
      ), 0) as load_hours,
      (exists (
        select 1 from class_sessions s
        join classes c2 on c2.id = s.class_id
        left join venues v2 on v2.id = c2.venue_id
        where s.coach_id = c.id and s.status = 'scheduled' and s.id <> p_session
          and (s.starts_at at time zone 'Asia/Kolkata')::date
            = (v_session.starts_at at time zone 'Asia/Kolkata')::date
          and abs(extract(epoch from (s.starts_at - v_session.ends_at))) <= 7200
          and (c2.venue_id is not distinct from v_class.venue_id
               or (v2.lat is not null and haversine_km(v_lat, v_lng, v2.lat, v2.lng) <= 3))
      ))::int as adjacency,
      c.tier
    from pool c
  ),
  norm as (
    select *,
      case when max(dist) over () = min(dist) over () then 1.0
           else 1.0 - (dist - min(dist) over ()) / nullif(max(dist) over () - min(dist) over (), 0) end as proximity_n,
      case when max(load_hours) over () = min(load_hours) over () then 1.0
           else 1.0 - (load_hours - min(load_hours) over ()) / nullif(max(load_hours) over () - min(load_hours) over (), 0) end as load_n,
      case when max(tier) over () = min(tier) over () then 1.0
           else (tier - min(tier) over ())::numeric / nullif(max(tier) over () - min(tier) over (), 0) end as seniority_n
    from metrics
  )
  select
    n.id,
    round(
      (v_weights->>'continuity')::numeric * n.continuity
      + (v_weights->>'proximity')::numeric * n.proximity_n
      + (v_weights->>'load')::numeric * n.load_n
      + (v_weights->>'adjacency')::numeric * n.adjacency
      + (v_weights->>'seniority')::numeric * n.seniority_n
      + case when p_preferred is not null and n.id = p_preferred then 40 else 0 end
    , 2) as score
  from norm n
  order by score desc, n.load_hours asc, n.tier desc, n.id asc;
end;
$$;

-- from 0004_assignment_engine.sql
create or replace function public.get_bookable_slots(
  p_lat float8, p_lng float8, p_duration int, p_player uuid, p_days int default 14
) returns table (starts_at timestamptz, coach_count int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_is_junior boolean;
begin
  select pl.date_of_birth is not null
     and pl.date_of_birth > (current_date - interval '18 years')
  into v_is_junior
  from players pl where pl.id = p_player;

  return query
  with candidate_coaches as (
    select c.* from coaches c
    where c.active
      and haversine_km(p_lat, p_lng, c.base_lat, c.base_lng) <= c.travel_radius_km
      and (not coalesce(v_is_junior, false) or c.dbs_checked)
  ),
  slots as (
    select generate_series(
      date_trunc('hour', now() + interval '24 hours'),
      now() + make_interval(days => p_days),
      interval '30 minutes'
    ) as slot_start
  )
  select s.slot_start, count(c.id)::int
  from slots s
  cross join candidate_coaches c
  where
    -- availability window
    exists (
      select 1 from coach_availability a
      where a.coach_id = c.id
        and a.weekday = ((extract(isodow from s.slot_start at time zone 'Asia/Kolkata'))::int - 1)
        and a.start_time <= (s.slot_start at time zone 'Asia/Kolkata')::time
        and a.end_time >= ((s.slot_start + make_interval(mins => p_duration)) at time zone 'Asia/Kolkata')::time
    )
    -- no approved time off
    and not exists (
      select 1 from coach_time_off t
      where t.coach_id = c.id and t.status = 'approved'
        and tstzrange(t.starts_at, t.ends_at)
          && tstzrange(s.slot_start, s.slot_start + make_interval(mins => p_duration))
    )
    -- no overlapping scheduled session (+ buffer, conservatively applied)
    and not exists (
      select 1 from class_sessions cs
      where cs.coach_id = c.id and cs.status = 'scheduled'
        and tstzrange(cs.starts_at - make_interval(mins => get_setting_int('travel_buffer_minutes', 30)),
                      cs.ends_at + make_interval(mins => get_setting_int('travel_buffer_minutes', 30)))
          && tstzrange(s.slot_start, s.slot_start + make_interval(mins => p_duration))
    )
  group by s.slot_start
  order by s.slot_start;
end;
$$;

-- from 0005_private_reschedule.sql
create or replace function public.request_private_class(payload jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
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
  if not has_active_subscription(v_client) then raise exception 'no_active_subscription'; end if;

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

  insert into private_class_details (class_id, client_id, player_id, address, postcode, lat, lng, has_table, access_notes)
  values (
    v_class_id, v_client, v_player,
    payload->>'address', coalesce(payload->>'postcode', ''),
    (payload->>'lat')::float8, (payload->>'lng')::float8,
    coalesce((payload->>'has_table')::boolean, true),
    payload->>'access_notes'
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
       'Coach confirmed for ' || to_char(v_start at time zone 'Asia/Kolkata', 'Dy DD Mon HH24:MI') || '.',
       jsonb_build_object('session_id', v_session_id, 'coach_id', v_coach, 'url', '/app/schedule')),
      (v_coach, 'new_private_session', 'New private session',
       to_char(v_start at time zone 'Asia/Kolkata', 'Dy DD Mon HH24:MI') || ' — ' || (payload->>'address'),
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
$$;

-- from 0005_private_reschedule.sql
create or replace function public.reschedule_booking(p_booking uuid, p_target_session uuid)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := auth.uid();
  v_booking bookings%rowtype;
  v_old_session class_sessions%rowtype;
  v_target class_sessions%rowtype;
  v_target_class classes%rowtype;
  v_hops int := 0;
  v_walk uuid;
  v_max_hops int := get_setting_int('reschedule_max_hops', 2);
  v_capacity int;
  v_confirmed int;
  v_new bookings%rowtype;
  v_first uuid; v_second uuid;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found or v_booking.client_id <> v_client then raise exception 'booking_not_found'; end if;
  if v_booking.status <> 'confirmed' then raise exception 'booking_not_live'; end if;

  -- hop limit (A11)
  v_walk := v_booking.rescheduled_from;
  while v_walk is not null loop
    v_hops := v_hops + 1;
    select rescheduled_from into v_walk from bookings where id = v_walk;
  end loop;
  if v_hops >= v_max_hops then raise exception 'reschedule_limit_reached'; end if;

  -- lock both sessions in consistent order (deadlock avoidance)
  if v_booking.session_id < p_target_session then
    v_first := v_booking.session_id; v_second := p_target_session;
  else
    v_first := p_target_session; v_second := v_booking.session_id;
  end if;
  perform 1 from class_sessions where id = v_first for update;
  perform 1 from class_sessions where id = v_second for update;

  select * into v_old_session from class_sessions where id = v_booking.session_id;
  if v_old_session.starts_at <= now() then raise exception 'session_started'; end if;

  select * into v_target from class_sessions where id = p_target_session;
  select * into v_target_class from classes where id = v_target.class_id;

  if v_target.status <> 'scheduled'
     or v_target.starts_at <= now() + make_interval(mins => get_setting_int('booking_cutoff_minutes', 60)) then
    raise exception 'target_not_bookable';
  end if;

  if exists (
    select 1 from bookings b
    join class_sessions cs on cs.id = b.session_id
    where b.player_id = v_booking.player_id and b.status = 'confirmed' and b.id <> p_booking
      and tstzrange(cs.starts_at, cs.ends_at) && tstzrange(v_target.starts_at, v_target.ends_at)
  ) then raise exception 'player_double_booked'; end if;

  v_capacity := coalesce(v_target.capacity_override, v_target_class.capacity);
  select count(*) into v_confirmed from bookings
  where session_id = p_target_session and status = 'confirmed';
  if v_confirmed >= v_capacity then raise exception 'target_full'; end if;

  insert into bookings (session_id, client_id, player_id, status, rescheduled_from)
  values (p_target_session, v_booking.client_id, v_booking.player_id, 'confirmed', p_booking)
  returning * into v_new;

  update bookings set status = 'rescheduled', cancelled_at = now() where id = p_booking;

  -- waitlist promotion on freed seat
  insert into notifications (user_id, type, title, body, data, scheduled_for)
  select b.client_id, 'waitlist_spot', 'A spot opened',
         'Claim it within ' || get_setting_int('waitlist_claim_minutes', 15) || ' minutes.',
         jsonb_build_object('booking_id', b.id, 'session_id', v_booking.session_id), now()
  from bookings b
  where b.session_id = v_booking.session_id and b.status = 'waitlisted'
  order by b.waitlist_position asc limit 1;

  insert into notifications (user_id, type, title, body, data) values
    (v_client, 'booking_rescheduled', 'Rescheduled.',
     to_char(v_target.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon HH24:MI'),
     jsonb_build_object('booking_id', v_new.id, 'url', '/app/schedule'));

  -- fresh reminders; sweep old ones
  delete from notifications where status = 'pending'
    and (data->>'booking_id')::uuid = p_booking
    and type in ('reminder_24h', 'reminder_2h');
  insert into notifications (user_id, type, title, body, data, scheduled_for) values
    (v_client, 'reminder_24h', 'Tomorrow', v_target_class.title,
     jsonb_build_object('booking_id', v_new.id, 'url', '/app/schedule'),
     v_target.starts_at - interval '24 hours'),
    (v_client, 'reminder_2h', 'Later today', v_target_class.title,
     jsonb_build_object('booking_id', v_new.id, 'url', '/app/schedule'),
     v_target.starts_at - interval '2 hours');

  return v_new;
end;
$$;

-- from 0006_fix_rls_p10_ops.sql
create or replace function public.reschedule_private_session(
  p_session uuid, p_new_start timestamptz, p_confirm bool default false
) returns table (proposed_coach uuid, coach_changed boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := auth.uid();
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_old_coach uuid;
  v_new_coach uuid;
  v_new_end timestamptz;
  v_fail text;
begin
  select * into v_session from class_sessions where id = p_session for update;
  if not found then raise exception 'session_not_found'; end if;
  select * into v_class from classes where id = v_session.class_id;

  if not exists (
    select 1 from private_class_details d
    where d.class_id = v_class.id and d.client_id = v_client
  ) then raise exception 'not_your_session'; end if;

  if p_new_start < now() + interval '24 hours' then
    raise exception 'lead_time_24h';
  end if;

  v_old_coach := v_session.coach_id;
  v_new_end := p_new_start + make_interval(mins => v_class.duration_minutes);

  -- Same-coach first (hard filters at the new time), else engine scoring.
  if v_old_coach is not null then
    -- Temporarily test the coach against the new window via a lightweight check
    v_fail := null;
    if exists (
      select 1 from coach_time_off t
      where t.coach_id = v_old_coach and t.status = 'approved'
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_new_start, v_new_end)
    ) then v_fail := 'time_off'; end if;
    if v_fail is null and not exists (
      select 1 from coach_availability a
      where a.coach_id = v_old_coach
        and a.weekday = ((extract(isodow from p_new_start at time zone 'Asia/Kolkata'))::int - 1)
        and a.start_time <= (p_new_start at time zone 'Asia/Kolkata')::time
        and a.end_time >= (v_new_end at time zone 'Asia/Kolkata')::time
    ) then v_fail := 'unavailable'; end if;
    if v_fail is null and exists (
      select 1 from class_sessions s2
      where s2.coach_id = v_old_coach and s2.status = 'scheduled' and s2.id <> p_session
        and tstzrange(s2.starts_at, s2.ends_at) && tstzrange(p_new_start, v_new_end)
    ) then v_fail := 'overlap'; end if;
    if v_fail is null then v_new_coach := v_old_coach; end if;
  end if;

  if v_new_coach is null then
    -- score candidates for the new time by moving the window transiently
    -- (preview-safe: inside a transaction; rolled back unless confirmed)
    update class_sessions set starts_at = p_new_start, ends_at = v_new_end, coach_id = null
    where id = p_session;
    select rc.coach_id into v_new_coach from rank_coaches(p_session) rc limit 1;
    if not p_confirm then
      -- undo the transient move for preview
      update class_sessions set starts_at = v_session.starts_at, ends_at = v_session.ends_at,
        coach_id = v_old_coach where id = p_session;
      return query select v_new_coach, (v_new_coach is distinct from v_old_coach);
      return;
    end if;
  elsif not p_confirm then
    return query select v_new_coach, false;
    return;
  end if;

  if v_new_coach is null then raise exception 'no_coach_available'; end if;

  update class_sessions
  set starts_at = p_new_start, ends_at = v_new_end, coach_id = v_new_coach
  where id = p_session;

  update coach_assignments set status = 'superseded'
  where session_id = p_session and status = 'active' and coach_id is distinct from v_new_coach;
  insert into coach_assignments (session_id, coach_id, assigned_by, status)
  select p_session, v_new_coach, v_client, 'active'
  where not exists (
    select 1 from coach_assignments
    where session_id = p_session and status = 'active' and coach_id = v_new_coach
  );

  insert into notifications (user_id, type, title, body, data) values
    (v_client, 'booking_rescheduled', 'Rescheduled.',
     to_char(p_new_start at time zone 'Asia/Kolkata', 'Dy DD Mon HH24:MI'),
     jsonb_build_object('session_id', p_session, 'url', '/app/schedule'));
  if v_old_coach is not null and v_old_coach <> v_new_coach then
    insert into notifications (user_id, type, title, body, data) values
      (v_old_coach, 'coach_changed', 'Session moved',
       'A private session was rescheduled away from you.',
       jsonb_build_object('session_id', p_session, 'url', '/coach/calendar'));
  end if;
  insert into notifications (user_id, type, title, body, data) values
    (v_new_coach, 'new_private_session', 'Private session (rescheduled)',
     to_char(p_new_start at time zone 'Asia/Kolkata', 'Dy DD Mon HH24:MI'),
     jsonb_build_object('session_id', p_session, 'url', '/coach/session/' || p_session));

  return query select v_new_coach, (v_new_coach is distinct from v_old_coach);
end;
$$;

-- from 0006_fix_rls_p10_ops.sql
create or replace function public.generate_class_sessions(p_weeks int default 8)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  d date;
  v_wd int;
  v_start timestamptz;
  v_count int := 0;
  v_time time;
begin
  for r in
    select c.*, (select s.starts_at from class_sessions s where s.class_id = c.id
                 order by s.starts_at limit 1) as first_start
    from classes c where c.class_type = 'group' and c.active
      and c.recurrence_rule like 'FREQ=WEEKLY%'
  loop
    v_wd := case substring(r.recurrence_rule from 'BYDAY=(..)')
      when 'MO' then 1 when 'TU' then 2 when 'WE' then 3 when 'TH' then 4
      when 'FR' then 5 when 'SA' then 6 else 7 end;
    v_time := coalesce((r.first_start at time zone 'Asia/Kolkata')::time, time '18:30');
    for d in select generate_series(current_date, current_date + p_weeks * 7, interval '1 day')::date loop
      exit when r.ends_on is not null and d > r.ends_on;
      if extract(isodow from d) = v_wd then
        v_start := (d::text || ' ' || v_time::text)::timestamp at time zone 'Asia/Kolkata';
        if v_start > now() and not exists (
          select 1 from class_sessions s where s.class_id = r.id and s.starts_at = v_start
        ) then
          insert into class_sessions (class_id, starts_at, ends_at)
          values (r.id, v_start, v_start + make_interval(mins => r.duration_minutes));
          v_count := v_count + 1;
        end if;
      end if;
    end loop;
  end loop;
  perform assign_unassigned_sessions();
  return v_count;
end;
$$;
