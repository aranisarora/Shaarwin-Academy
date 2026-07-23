-- Claim a waitlist spot (whatsapp-upgrade-plan Part 5).
--
-- When a seat frees up we offer it to the head of the waitlist (waitlist_spot
-- notification). Accepting used to have no server-side path — the offer link
-- pointed at a page that re-booking couldn't promote through (the one-live-
-- booking-per-player unique index blocks a second insert). This RPC promotes
-- the caller's own waitlisted booking to confirmed if a seat is still free,
-- else raises 'spot_gone'. Reused by the WhatsApp "Claim spot" button and
-- available to the app.
CREATE OR REPLACE FUNCTION public.claim_waitlist_spot(p_booking uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_booking bookings%rowtype;
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_capacity int;
  v_confirmed int;
begin
  select * into v_booking from bookings where id = p_booking for update;
  if not found or (v_booking.client_id <> v_client and not is_founder()) then
    raise exception 'booking_not_found';
  end if;
  if v_booking.status <> 'waitlisted' then
    raise exception 'not_waitlisted';
  end if;

  select * into v_session from class_sessions where id = v_booking.session_id for update;
  if v_session.status <> 'scheduled'
     or v_session.starts_at <= now() + make_interval(mins => get_setting_int('booking_cutoff_minutes', 60)) then
    raise exception 'session_not_bookable';
  end if;
  select * into v_class from classes where id = v_session.class_id;

  v_capacity := coalesce(v_session.capacity_override, v_class.capacity);
  select count(*) into v_confirmed from bookings
  where session_id = v_booking.session_id and status = 'confirmed';
  if v_confirmed >= v_capacity then
    raise exception 'spot_gone';
  end if;

  update bookings
  set status = 'confirmed', waitlist_position = null
  where id = p_booking;

  -- Confirmation + the single upcoming reminder, mirroring book_session.
  insert into notifications (user_id, type, title, body, data, scheduled_for) values
    (v_booking.client_id, 'booking_confirmed', 'Booked.',
     to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI am') || ' — ' || v_class.title,
     jsonb_build_object('booking_id', v_booking.id, 'session_id', v_booking.session_id, 'url', '/app/schedule'),
     now()),
    (v_booking.client_id, 'reminder_upcoming', 'Later today', v_class.title,
     jsonb_build_object('booking_id', v_booking.id, 'session_id', v_booking.session_id,
       'class_title', v_class.title,
       'time_str', to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
       'url', '/app/schedule'),
     v_session.starts_at - interval '3 hours');

  return 'confirmed';
end;
$function$;
