-- Founder notification philosophy: only ping the founder when an action is
-- expected of them, never for happy-path status updates.
--
-- 1. coach_confirm_session: a coach confirming they're coming is the expected
--    path and needs no founder action, so drop the "Coach confirmed" ping.
--    (The notify worker escalates to the founder only if a coach has NOT
--    confirmed close to start time — see supabase/functions/notify.)
-- 2. coach_mark_arrival: parents are always told (arrived or late). Founders are
--    pinged ONLY when the coach is running late (they may need to step in). A
--    normal on-time arrival is the happy path — no founder ping. If the class
--    starts with no arrival marked, the notify worker escalates separately.

CREATE OR REPLACE FUNCTION public.coach_confirm_session(p_session uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session class_sessions%rowtype;
  v_at      timestamptz;
begin
  select * into v_session from class_sessions where id = p_session;
  if v_session.coach_id is null or v_session.coach_id <> auth.uid() then
    raise exception 'not_your_session';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'session_not_scheduled';
  end if;

  update class_sessions
     set coach_confirmed_at = coalesce(coach_confirmed_at, now())
   where id = p_session
   returning coach_confirmed_at into v_at;

  -- Founders are intentionally NOT notified: a routine confirmation needs no
  -- action from them. The notify worker escalates only when a coach has still
  -- not confirmed ~10 minutes before the class starts.
  return v_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.coach_mark_arrival(p_session uuid, p_late boolean DEFAULT false)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    update class_sessions
       set coach_arrived_at = coalesce(coach_arrived_at, now())
     where id = p_session
     returning coach_arrived_at into v_arrived;
    v_type  := 'coach_arrived';
    v_title := 'Coach has arrived';
    v_body  := 'Coach ' || v_name || ' is at ' || v_location
               || ' for the ' || v_time || ' session.';
  end if;

  -- Booked clients (parents) are always told — arrived or late both matter to
  -- them.
  insert into notifications (user_id, type, title, body, data)
  select distinct b.client_id, v_type, v_title, v_body,
         jsonb_build_object('session_id', p_session, 'url', '/app')
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
