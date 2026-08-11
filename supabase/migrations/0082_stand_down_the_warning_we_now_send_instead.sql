-- The arrival stand-down has to withdraw the alert we ACTUALLY sent.
--
-- The notify worker used to escalate a silent coach twice: ops_coach_unconfirmed
-- at T-10 ("hasn't confirmed, starts in ~10 min") and then ops_coach_not_arrived
-- at start+10 ("10+ minutes in, likely a no-show"). One coach, one problem, two
-- buzzes — and the founder asked for one. The worker now suppresses the second
-- whenever it would say nothing the first didn't: same session, same recipient,
-- and the coach still hasn't confirmed or reported running late.
--
-- That suppression quietly broke this function. The stand-down below — the whole
-- point of 0079, written after the founders were told at 06:30:03 to call Ramesh
-- Simpi and his arrival landed at 06:32:13 with nothing to withdraw it — matches
-- on `n.type = 'ops_coach_not_arrived'`. Suppress that row and there is nothing
-- for the arrival to find, so the founder is left holding a warning about a coach
-- who has since walked in. The exact failure 0079 exists to prevent, reintroduced
-- from the other end: 0079 fixed "nothing withdrew the alert", and dropping the
-- second alert turned that into "nothing to withdraw".
--
-- So the stand-down now also matches the T-10 warning — but ONLY once the class
-- is 10+ minutes old, which is the same threshold the suppressed escalation fires
-- on. That bound is doing real work and is not a tidiness measure:
-- ops_coach_unconfirmed sent 705 times in 30 days, and the overwhelming majority
-- of those coaches simply turn up without ever tapping confirm. Standing every
-- one of them down would answer "stop sending me two notifications" with roughly
-- seven hundred more. Bounded this way it withdraws precisely the alerts the
-- suppression swallowed and nothing else.
--
-- `distinct` because a founder can hold both rows for one session — added after
-- the T-10 warning, say, so the start+10 escalation was never suppressed for
-- them — and two identical "no need to chase" messages is the noise this whole
-- change set is about.
--
-- Both founder-facing rows also gain the session deep link. url was
-- '/admin/schedule', which opens the current week and leaves the founder to find
-- the right card among forty; ?date=&session= opens the session itself. The date
-- is the ACADEMY wall date, never the UTC one — a 12:30am IST session falls on
-- the previous UTC day, and ?date= is what decides which week the schedule opens.

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
  v_url     text;
  v_arrived timestamptz;
  v_won     boolean;
begin
  select coach_id, starts_at, class_id, status
    into v_coach, v_starts, v_class, v_status
    from class_sessions where id = p_session;

  if v_coach is null or v_coach <> auth.uid() then
    raise exception 'not_your_session';
  end if;

  -- A cancelled class has no arrival to report (0079). Distinct from the window
  -- error because the callers can say something useful about each.
  if v_status = 'cancelled' then
    raise exception 'session_cancelled';
  end if;

  -- Outside a plausible travel window this is a stale tap, not an arrival — a
  -- push banner lives in the tray until dismissed, so yesterday's "Have you
  -- reached?" is still tappable this morning (0079).
  if now() < v_starts - interval '2 hours' or now() > v_starts + interval '2 hours' then
    raise exception 'outside_arrival_window';
  end if;

  select split_part(coalesce(nullif(trim(full_name), ''), 'Your coach'), ' ', 1)
    into v_name
    from profiles where id = v_coach;

  v_location := coalesce(class_location_label(v_class), 'the venue');

  v_time := to_char(v_starts at time zone 'Asia/Kolkata', 'FMHH12:MI AM');

  -- The founder's link into the session itself. Asia/Kolkata, not UTC: see the
  -- header.
  v_url := '/admin/schedule?date='
           || to_char(v_starts at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
           || '&session=' || p_session::text;

  if p_late then
    -- Late implies coming, exactly as arrived does. Recording BOTH is what
    -- stops the founder escalation calling this coach silent, and stops the
    -- confirm ladder chasing someone who has already answered.
    -- coach_arrived_at is deliberately untouched: they are not there yet, and
    -- the start+10 escalation still needs to fire if they never turn up.
    --
    -- `where coach_late_at is null` is the idempotence (0079): a second report
    -- of the same lateness changes nothing and tells nobody.
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
    -- Arrived implies coming: also stamp confirm + provenance so a coach who
    -- only ever taps "arrived" is never nagged or escalated as unconfirmed.
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
  -- nothing — the first caller's messages are already on their way (0079).
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
           jsonb_build_object('session_id', p_session, 'url', v_url)
      from profiles p where p.role = 'founder';
  else
    -- Close the loop on an escalation this arrival has just made untrue (0079).
    -- Only the founders who were actually told, and only once — a second
    -- arrival never wins the transition above, so it cannot reach here.
    --
    -- Either alert counts, because either one may be the only one they got: the
    -- worker now sends the T-10 warning INSTEAD OF the start+10 escalation when
    -- the coach has stayed silent throughout. The 10-minute bound on the warning
    -- keeps that from standing down the several hundred coaches a month who
    -- never confirm and simply turn up on time — see the header.
    insert into notifications (user_id, type, title, body, data)
    select distinct n.user_id, 'ops_coach_arrived_late', 'Coach has now arrived',
           'Coach ' || v_name || ' has arrived at ' || v_location
             || ' for the ' || v_time || ' session — no need to chase.',
           jsonb_build_object('session_id', p_session, 'url', v_url)
      from notifications n
     where n.data->>'session_id' = p_session::text
       and (
         n.type = 'ops_coach_not_arrived'
         or (n.type = 'ops_coach_unconfirmed'
             and now() > v_starts + interval '10 minutes')
       );
  end if;

  return v_arrived;
end;
$function$;

grant execute on function public.coach_mark_arrival(uuid, boolean, text, integer)
  to authenticated;
