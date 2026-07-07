-- P07 — request_private_class · P10 — reschedule RPCs

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
  values ('private', 'Private session', 'beginner', 1, v_duration, (v_start at time zone 'Europe/London')::date, v_client)
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
       'Coach confirmed for ' || to_char(v_start at time zone 'Europe/London', 'Dy DD Mon HH24:MI') || '.',
       jsonb_build_object('session_id', v_session_id, 'coach_id', v_coach, 'url', '/app/schedule')),
      (v_coach, 'new_private_session', 'New private session',
       to_char(v_start at time zone 'Europe/London', 'Dy DD Mon HH24:MI') || ' — ' || (payload->>'address'),
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

-- P10 — group reschedule, atomic.
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
     to_char(v_target.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI'),
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
