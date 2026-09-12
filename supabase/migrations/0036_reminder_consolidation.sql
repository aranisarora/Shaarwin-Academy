-- Reminder consolidation (whatsapp-upgrade-plan Part 4).
--
-- Every booking used to insert TWO reminders — reminder_24h and reminder_2h.
-- On WhatsApp, Twilio's flat per-message fee dominates at India rates, so two
-- reminders cost twice as much for no extra value. Collapse them into ONE
-- reminder_upcoming, fired ~3h before the session, carrying the display fields
-- (class_title, time_str) the client_session_reminder template needs.
--
-- Cancel/reschedule sweeps of stale pending reminders keep the old type names
-- (so in-flight reminder_24h/reminder_2h rows are still swept) and add the new
-- reminder_upcoming.
--
-- Functions rebuilt (bodies otherwise identical to the live definitions):
--   _book_one, book_session, reschedule_booking  — insert the single reminder
--   cancel_booking, cancel_series                — extend the sweep type list

-- 1. _book_one (group series booking helper) -------------------------------
CREATE OR REPLACE FUNCTION public._book_one(p_session uuid, p_client uuid, p_player uuid, p_series uuid DEFAULT NULL::uuid, p_notify boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           to_char(v_session.starts_at at time zone v_tz, 'Dy DD Mon, FMHH12:MI am') || ' — ' || v_class.title,
           jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
           now());
      end if;
      -- one consolidated reminder ~3h before start (P11 delivers)
      insert into notifications (user_id, type, title, body, data, scheduled_for) values
        (p_client, 'reminder_upcoming', 'Later today', v_class.title,
         jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session,
           'class_title', v_class.title,
           'time_str', to_char(v_session.starts_at at time zone v_tz, 'FMHH12:MI am'),
           'url', '/app/schedule'),
         v_session.starts_at - interval '3 hours');
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
$function$;

-- 2. book_session (single group booking) -----------------------------------
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

    -- confirmation + one consolidated reminder ~3h before start (P11 delivers)
    insert into notifications (user_id, type, title, body, data, scheduled_for) values
      (v_client, 'booking_confirmed', 'Booked.',
       to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI am') || ' — ' || v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
       now()),
      (v_client, 'reminder_upcoming', 'Later today', v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session,
         'class_title', v_class.title,
         'time_str', to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
         'url', '/app/schedule'),
       v_session.starts_at - interval '3 hours');
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

-- 3. reschedule_booking -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking uuid, p_target_session uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     to_char(v_target.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am'),
     jsonb_build_object('booking_id', v_new.id, 'url', '/app/schedule'));

  -- fresh reminder; sweep old ones (keep legacy types for in-flight rows)
  delete from notifications where status = 'pending'
    and (data->>'booking_id')::uuid = p_booking
    and type in ('reminder_24h', 'reminder_2h', 'reminder_upcoming');
  insert into notifications (user_id, type, title, body, data, scheduled_for) values
    (v_client, 'reminder_upcoming', 'Later today', v_target_class.title,
     jsonb_build_object('booking_id', v_new.id, 'session_id', p_target_session,
       'class_title', v_target_class.title,
       'time_str', to_char(v_target.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
       'url', '/app/schedule'),
     v_target.starts_at - interval '3 hours');

  return v_new;
end;
$function$;

-- 4. cancel_booking (extend reminder sweep) --------------------------------
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
    and type in ('reminder_24h', 'reminder_2h', 'reminder_upcoming');
end;
$function$;

-- 5. cancel_series (extend reminder sweep) ---------------------------------
CREATE OR REPLACE FUNCTION public.cancel_series(p_series uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      and type in ('reminder_24h','reminder_2h','reminder_upcoming');
  end loop;

  update booking_series set active = false, cancelled_at = now() where id = p_series;
  return v_count;
end;
$function$;
