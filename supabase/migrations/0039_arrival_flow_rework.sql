-- Arrival flow rework (Part 1): geofence coords, arrival provenance,
-- arrived-implies-coming, undo, and private-occurrence reminders.

-- 1. Columns
alter table venues add column if not exists lat double precision,
                   add column if not exists lng double precision;

alter table class_sessions
  add column if not exists coach_arrival_source text
    check (coach_arrival_source in ('auto','tap','wa')),
  add column if not exists coach_arrival_distance_m integer;

-- 2. coach_mark_arrival — new 4-arg signature. Drop the old 2-arg first to
-- avoid an ambiguous overload once defaults are added.
drop function if exists public.coach_mark_arrival(uuid, boolean);

create or replace function public.coach_mark_arrival(
  p_session uuid,
  p_late boolean default false,
  p_source text default 'tap',
  p_distance_m integer default null
)
 returns timestamptz
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_coach   uuid;
  v_starts  timestamptz;
  v_class   uuid;
  v_name    text;
  v_location text;
  v_time    text;
  v_type    text;
  v_title   text;
  v_body    text;
  v_arrived timestamptz;
begin
  select coach_id, starts_at, class_id
    into v_coach, v_starts, v_class
    from class_sessions where id = p_session;

  if v_coach is null or v_coach <> auth.uid() then
    raise exception 'not_your_session';
  end if;

  select split_part(coalesce(nullif(trim(full_name), ''), 'Your coach'), ' ', 1)
    into v_name
    from profiles where id = v_coach;

  select coalesce(v.name, pcd.address, 'the venue')
    into v_location
    from classes c
    left join venues v on v.id = c.venue_id
    left join private_class_details pcd on pcd.class_id = c.id
    where c.id = v_class
    limit 1;

  v_time := to_char(v_starts at time zone 'Asia/Kolkata', 'FMHH12:MI AM');

  if p_late then
    v_type  := 'coach_late';
    v_title := 'Coach running late';
    v_body  := 'Coach ' || v_name || ' is running a few minutes late for the '
               || v_time || ' session.';
  else
    -- Arrived implies coming: also stamp confirm + provenance so a coach who
    -- only ever taps "arrived" is never nagged or escalated as unconfirmed.
    update class_sessions
       set coach_arrived_at        = coalesce(coach_arrived_at, now()),
           coach_confirmed_at       = coalesce(coach_confirmed_at, now()),
           coach_arrival_source     = coalesce(coach_arrival_source, p_source),
           coach_arrival_distance_m = coalesce(coach_arrival_distance_m, p_distance_m)
     where id = p_session
     returning coach_arrived_at into v_arrived;
    v_type  := 'coach_arrived';
    v_title := 'Coach has arrived';
    v_body  := 'Coach ' || v_name || ' is at ' || v_location
               || ' for the ' || v_time || ' session.';
  end if;

  -- Booked clients (parents) are always told — arrived or late both matter to
  -- them. Auto arrivals delay 2 minutes so an Undo beats delivery; manual and
  -- WhatsApp taps notify immediately. Data carries coach_name/location/time so
  -- the notify worker can render the parent WhatsApp without re-querying.
  insert into notifications (user_id, type, title, body, data, scheduled_for)
  select distinct b.client_id, v_type, v_title, v_body,
         jsonb_build_object('session_id', p_session, 'url', '/app',
           'coach_name', v_name, 'location_str', v_location, 'time_str', v_time),
         case when p_source = 'auto' then now() + interval '2 minutes' else now() end
    from bookings b
   where b.session_id = p_session
     and b.status in ('confirmed', 'attended');

  -- Founders are pinged ONLY when the coach is running late (they may need to
  -- act). A normal on-time arrival needs no founder ping; the notify worker
  -- escalates separately if the class starts with no arrival marked.
  if p_late then
    insert into notifications (user_id, type, title, body, data)
    select p.id, v_type, v_title, v_body,
           jsonb_build_object('session_id', p_session, 'url', '/admin/schedule')
      from profiles p where p.role = 'founder';
  end if;

  return v_arrived;
end;
$function$;

grant execute on function public.coach_mark_arrival(uuid, boolean, text, integer)
  to anon, authenticated, service_role;

-- 3. coach_undo_arrival — coach-only, within 10 minutes of arrival. Clears the
-- arrival (keeps coach_confirmed_at — the coach is still coming) and deletes
-- still-pending parent notification rows for this session.
create or replace function public.coach_undo_arrival(p_session uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_coach   uuid;
  v_arrived timestamptz;
begin
  select coach_id, coach_arrived_at
    into v_coach, v_arrived
    from class_sessions where id = p_session;

  if v_coach is null or v_coach <> auth.uid() then
    raise exception 'not_your_session';
  end if;

  if v_arrived is null or now() - v_arrived > interval '10 minutes' then
    raise exception 'undo_window_passed';
  end if;

  update class_sessions
     set coach_arrived_at        = null,
         coach_arrival_source     = null,
         coach_arrival_distance_m = null
   where id = p_session;

  delete from notifications
   where type = 'coach_arrived'
     and status = 'pending'
     and data->>'session_id' = p_session::text;
end;
$function$;

grant execute on function public.coach_undo_arrival(uuid)
  to anon, authenticated, service_role;

-- 4. reminder_upcoming fix — private occurrences insert into bookings directly
-- and skipped _book_one's reminder insert. Add the same consolidated ~3h
-- reminder here, unconditionally (series-materialized weeks still want it).
create or replace function public._create_private_occurrence(p_client uuid, p_player uuid, p_start timestamp with time zone, p_duration integer, p_address text, p_postcode text, p_lat double precision, p_lng double precision, p_has_table boolean, p_access_notes text, p_address_details jsonb, p_preferred uuid DEFAULT NULL::uuid, p_series uuid DEFAULT NULL::uuid, p_notify boolean DEFAULT true)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  -- One consolidated reminder ~3h before start (P11 delivers). _book_one adds
  -- this for group bookings; private occurrences insert into bookings directly
  -- and would otherwise skip it. Unconditional (not gated on p_notify) so
  -- series-materialized weeks still get reminders.
  insert into notifications (user_id, type, title, body, data, scheduled_for) values
    (p_client, 'reminder_upcoming', 'Later today', 'Private session',
     jsonb_build_object('booking_id', v_booking.id, 'session_id', v_session_id,
       'class_title', 'Private session',
       'time_str', to_char(p_start at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
       'url', '/app/schedule'),
     p_start - interval '3 hours');

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
$function$;
