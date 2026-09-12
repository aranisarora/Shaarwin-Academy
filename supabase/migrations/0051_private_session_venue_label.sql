-- The fifth call site, missed by 0049/0050.
--
-- 0049 fixed the four paths that resolve a location *at read time* (the cover
-- offer, "have you reached?", "your coach has arrived", the founder booking
-- ping). But `_create_private_occurrence` composes the coach's "New private
-- session" message at BOOKING time and interpolates its raw `p_address`
-- parameter straight into the body:
--
--   'Thu 30 Jul, 11:00 am — 24th Main Rd, Bengaluru, 560102, India'
--
-- when that address is, exactly, the academy venue "Assetz Avenue HSR".
--
-- It was missed because it is the one path that never touches
-- private_class_details on the read side — it already holds the address as an
-- argument, so it never joined to anything that a resolver could hook into.
--
-- Worth knowing for anything similar: a notification's `body` is frozen at
-- INSERT. Fixing a read-time resolver silently repairs nothing already queued,
-- and rows composed here sit in the table until their session arrives. This is
-- why the four read-time paths and this one had to be fixed separately.
--
-- The insert of private_class_details above already happened, so
-- class_location_label() can see the address AND the geocoded address_details
-- (POI name, locality) that migration 0050 reads.

CREATE OR REPLACE FUNCTION public._create_private_occurrence(p_client uuid, p_player uuid, p_start timestamp with time zone, p_duration integer, p_address text, p_postcode text, p_lat double precision, p_lng double precision, p_has_table boolean, p_access_notes text, p_address_details jsonb, p_preferred uuid DEFAULT NULL::uuid, p_series uuid DEFAULT NULL::uuid, p_notify boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- The venue's name, not the geocoded address behind it. Falls back to the
    -- raw address so a location the resolver can't name still tells the coach
    -- where to go. location_str mirrors the other coach-facing types.
    insert into notifications (user_id, type, title, body, data)
    values (v_coach, 'new_private_session', 'New private session',
      to_char(p_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am')
        || ' — ' || coalesce(class_location_label(v_class_id), p_address),
      jsonb_build_object('session_id', v_session_id,
        'location_str', coalesce(class_location_label(v_class_id), p_address),
        'time_str', to_char(p_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am'),
        'url', '/coach/session/' || v_session_id));
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
