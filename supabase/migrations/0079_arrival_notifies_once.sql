-- Arrival stops shouting twice, stops accepting the impossible, and cleans up
-- after the escalation it contradicts.
--
-- Three defects, all in coach_mark_arrival, all found by reading a day of
-- production traffic on 10 Aug 2026.
--
-- 1. DUPLICATE PARENT MESSAGES. The timestamp was idempotent — `coalesce(
--    coach_arrived_at, now())` — but the notification INSERT underneath it was
--    not. It ran on every call, so a second "I've arrived" wrote a second
--    message to every booked parent while correctly leaving the timestamp
--    alone. Five families have already received the same "Coach has arrived"
--    twice.
--
--    The dominant trigger is not a fumbled double-tap. It is the geofenced
--    auto-arrival racing the coach's own tap: SessionArrival fires
--    markArrived({source:'auto'}) from a GPS callback while the manual button is
--    still on screen, and both land inside a second. Because the auto branch
--    below defers its parent ping by two minutes so Undo can beat it, the pair
--    is written with different `scheduled_for` values and therefore *always*
--    lands in different delivery batches — which is precisely where the notify
--    worker's per-batch, in-memory dedupe cannot see it. The one duplicate pair
--    it did collapse was the only one where both rows had zero deferral.
--
--    Fix: notify on the STATE TRANSITION, not on the call. The update now
--    carries its own `where ... is null` and reports whether it won, so the
--    second caller returns the existing timestamp having sent nothing. The
--    predicate is evaluated under the row lock, so two concurrent calls resolve
--    correctly without an advisory lock.
--
-- 2. NO GUARD ON WHEN OR WHAT. The function checked only that the caller owned
--    the session — no time bound, no status check. Production has both failure
--    modes on record: an arrival stamped 154 minutes after start, and an
--    arrival stamped on a CANCELLED session. Push sharpens this: an Android
--    banner lives in the tray until it is dismissed (the one-hour push TTL
--    bounds delivery by the push service, not the life of the notification), so
--    yesterday's unanswered "Have you reached?" is still tappable this morning
--    — and tapping it messaged that session's families about a class that
--    finished a day ago.
--
--    Fix: ±2 hours around the start, and never on a cancelled session. The
--    coach screen already gates itself to [start-60min, ends_at]
--    (SessionArrival), so this only ever binds the WhatsApp and push paths,
--    which had no window at all. Symmetric around `starts_at` rather than
--    hanging off `ends_at` so a long session doesn't quietly buy a longer tail.
--
-- 3. THE ESCALATION IT CONTRADICTS WAS NEVER WITHDRAWN. sweepFounderEscalations
--    fires ops_coach_not_arrived at start+10 and never revisits it. On 10 Aug
--    the founders were told at 06:30:03 to call Ramesh Simpi; his arrival
--    landed at 06:32:13, seventy seconds after their phones buzzed, and nothing
--    told them so. The coach then heard he had been reported absent for a class
--    he had just reported arriving at, which is the complaint that started all
--    of this.
--
--    Fix: when an arrival wins the transition AND an ops_coach_not_arrived
--    already exists for that session, queue an ops_coach_arrived_late to the
--    founders who were alerted. Scoped to those founders by design — telling
--    somebody a problem is resolved when they never heard about it is just
--    another interruption.

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
  v_status  session_status;
  v_name    text;
  v_location text;
  v_time    text;
  v_type    text;
  v_title   text;
  v_body    text;
  v_arrived timestamptz;
  v_won     boolean;
begin
  select coach_id, starts_at, class_id, status
    into v_coach, v_starts, v_class, v_status
    from class_sessions where id = p_session;

  if v_coach is null or v_coach <> auth.uid() then
    raise exception 'not_your_session';
  end if;

  -- A cancelled class has no arrival to report. Distinct from the window error
  -- because the callers can say something useful about each.
  if v_status = 'cancelled' then
    raise exception 'session_cancelled';
  end if;

  -- Outside a plausible travel window this is a stale tap, not an arrival.
  if now() < v_starts - interval '2 hours' or now() > v_starts + interval '2 hours' then
    raise exception 'outside_arrival_window';
  end if;

  select split_part(coalesce(nullif(trim(full_name), ''), 'Your coach'), ' ', 1)
    into v_name
    from profiles where id = v_coach;

  v_location := coalesce(class_location_label(v_class), 'the venue');

  v_time := to_char(v_starts at time zone 'Asia/Kolkata', 'FMHH12:MI AM');

  if p_late then
    -- Late implies coming, exactly as arrived does. Recording BOTH is what
    -- stops the founder escalation calling this coach silent, and stops the
    -- confirm ladder chasing someone who has already answered.
    -- coach_arrived_at is deliberately untouched: they are not there yet, and
    -- the start+10 escalation still needs to fire if they never turn up. It
    -- just has to say something true when it does.
    --
    -- `where coach_late_at is null` is the whole idempotence: the second report
    -- of the same lateness changes nothing and tells nobody, while the FIRST
    -- still reaches everyone. Reporting lateness twice is a coach being
    -- thorough, not a coach being late twice.
    update class_sessions
       set coach_late_at      = now(),
           coach_confirmed_at = coalesce(coach_confirmed_at, now())
     where id = p_session
       and coach_late_at is null;
    v_won := found;
    v_type  := 'coach_late';
    v_title := 'Coach running late';
    v_body  := 'Coach ' || v_name || ' is running a few minutes late for the '
               || v_time || ' session.';
  else
    update class_sessions
       set coach_arrived_at        = now(),
           coach_confirmed_at       = coalesce(coach_confirmed_at, now()),
           coach_arrival_source     = p_source,
           coach_arrival_distance_m = p_distance_m
     where id = p_session
       and coach_arrived_at is null
     returning coach_arrived_at into v_arrived;
    v_won := found;
    v_type  := 'coach_arrived';
    v_title := 'Coach has arrived';
    v_body  := 'Coach ' || v_name || ' is at ' || v_location
               || ' for the ' || v_time || ' session.';
  end if;

  -- Somebody else already recorded this. Report the state honestly and send
  -- nothing — the first caller's messages are already on their way.
  if not v_won then
    select coach_arrived_at into v_arrived from class_sessions where id = p_session;
    return v_arrived;
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
  else
    -- Close the loop on an escalation this arrival has just made untrue. Only
    -- the founders who were actually told, and only once — a second arrival
    -- can't reach here because it never wins the transition above.
    insert into notifications (user_id, type, title, body, data)
    select n.user_id, 'ops_coach_arrived_late', 'Coach has now arrived',
           'Coach ' || v_name || ' has arrived at ' || v_location
             || ' for the ' || v_time || ' session — no need to chase.',
           jsonb_build_object('session_id', p_session, 'url', '/admin/schedule')
      from notifications n
     where n.type = 'ops_coach_not_arrived'
       and n.data->>'session_id' = p_session::text;
  end if;

  return v_arrived;
end;
$function$;

grant execute on function public.coach_mark_arrival(uuid, boolean, text, integer)
  to authenticated;

-- coach_undo_arrival deliberately does NOT clear coach_late_at. Undo means "I
-- am not there yet after all", which leaves a reported lateness true rather
-- than retracting it. It DOES clear coach_arrived_at, which now also restores
-- the ability to win the transition again — an undo followed by a real arrival
-- notifies the parents, as it should.
