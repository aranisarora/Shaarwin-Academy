-- One coach_mark_arrival that is actually both of the last two changes.
--
-- 0082 and 0083 were written on branches that ran side by side, merged a few
-- minutes apart, and never saw each other. Both are a full
-- `create or replace function public.coach_mark_arrival`, so they do not
-- compose: whichever is applied second is simply the function, and everything
-- the other one did to it is gone.
--
--   0082 (PR #35) kept the four-argument signature and added the founder's
--        session deep link (v_url), the `distinct` on the stand-down insert, and
--        the broadened stand-down that also withdraws the T-10
--        ops_coach_unconfirmed warning once the class is 10+ minutes old.
--   0083 (PR #36) cut the signature to three arguments, dropped the 'auto'
--        two-minute parent delay, and added 'push' to the source check.
--
-- Applied in file order — 0082 then 0083 — production ends up with 0083's body,
-- which silently reverts every database-side change in 0082: founders go back to
-- '/admin/schedule' with forty cards to search, and the stand-down goes back to
-- matching only ops_coach_not_arrived, which is the exact bug 0082 exists to fix
-- and which the notify worker's new suppression makes reachable again.
--
-- supabase/schema.sql already holds the correct reconciliation — the merge
-- resolved it there by hand, and it is the only place the merged function
-- exists. Nothing in supabase/migrations/ reproduces it, so replaying the
-- migrations does not build it. This file is that resolution, written out so the
-- two are the same thing: the body below is copied verbatim from schema.sql.
--
-- Apply this INSTEAD OF 0082 and 0083, not after them. It is written to be safe
-- from any of the three starting points — the pre-0079 function still in
-- production, 0082's, or 0083's.
--
-- WHY IT IS URGENT. Production is serving the merged app right now, and its
-- check constraint is still ARRAY['auto','tap','wa']. app/api/push-action sends
-- p_source => 'push'. Every arrival marked from the notification tray — the
-- lock-screen path 6 of 9 coaches use — is failing on that constraint until this
-- runs. Production also never received 0079_arrival_notifies_once (there are two
-- migrations numbered 0079 and only the venues one landed), so its function has
-- neither `v_won` nor the `where coach_arrived_at is null` guard and parents can
-- still be told "Coach has arrived" twice. This file lands that fix too.

-- ── The source set ──────────────────────────────────────────────────────────
alter table public.class_sessions
  drop constraint if exists class_sessions_coach_arrival_source_check;

alter table public.class_sessions
  add constraint class_sessions_coach_arrival_source_check
  check (coach_arrival_source = any (array['auto'::text, 'tap'::text, 'wa'::text, 'push'::text]));

comment on column public.class_sessions.coach_arrival_source is
  'Where the arrival was marked: ''tap'' in the app, ''push'' on the notification button, ''wa'' from WhatsApp. ''auto'' is historical — the geofence that wrote it was removed, and nothing writes it now.';

comment on column public.class_sessions.coach_arrival_distance_m is
  'Historical. Metres between the coach''s device and the venue when geofenced auto-arrival marked them. Nothing has written this since the fence was removed; it is kept so founder_day_report and the admin schedule readers keep their shape.';

-- ── The one function ────────────────────────────────────────────────────────
-- Dropped rather than replaced: p_distance_m had a default, so leaving the
-- four-argument version beside the three-argument one makes every three-argument
-- call ambiguous. `if exists` because it may already be gone.
drop function if exists public.coach_mark_arrival(uuid, boolean, text, integer);

CREATE OR REPLACE FUNCTION public.coach_mark_arrival(p_session uuid, p_late boolean DEFAULT false, p_source text DEFAULT 'tap'::text)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- The founder's link into the session itself, not into "this week" (0082).
  -- The ACADEMY wall date, never the UTC one: a 12:30am IST session falls on the
  -- previous UTC day, and ?date= is what decides which week the schedule opens
  -- on — so the late-night sessions most likely to be in trouble are exactly the
  -- ones a UTC date would land a week away from.
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
       set coach_arrived_at    = now(),
           coach_confirmed_at  = coalesce(coach_confirmed_at, now()),
           coach_arrival_source = p_source
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
  -- nothing — the first caller's messages are already on their way. With the
  -- geofence gone this is no longer auto-versus-tap; it is the same coach
  -- answering twice, from the tray and then in the app, which is exactly what
  -- three entry points to one question invite (0079, 0083).
  if not v_won then
    select coach_arrived_at into v_arrived from class_sessions where id = p_session;
    return v_arrived;
  end if;

  -- Booked clients (parents) are always told — arrived or late both matter to
  -- them. Immediately, in every case: the two-minute hold here existed so an
  -- Undo could beat delivery of an arrival the coach had not asked for, and
  -- every source left is a deliberate tap (0083). Data carries
  -- coach_name/location/time so the notify worker can render the parent
  -- WhatsApp without re-querying.
  insert into notifications (user_id, type, title, body, data)
  select distinct b.client_id, v_type, v_title, v_body,
         jsonb_build_object('session_id', p_session, 'url', '/app',
           'coach_name', v_name, 'location_str', v_location, 'time_str', v_time)
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
    -- EITHER alert counts, because either may be the only one they were sent
    -- (0082). The notify worker no longer escalates a silent coach twice: when
    -- the T-10 "hasn't confirmed" warning has already gone out and nothing about
    -- the coach has changed since, the start+10 "hasn't marked arrived" is
    -- suppressed. Matching only on the latter therefore left the founder holding
    -- a live warning about a coach who had since walked in — 0079's own bug,
    -- reintroduced from the other end.
    --
    -- The 10-minute bound is load-bearing, not tidiness. ops_coach_unconfirmed
    -- sent 705 times in 30 days and most of those coaches simply turn up without
    -- ever tapping confirm; standing all of them down would answer "stop sending
    -- me two notifications" with several hundred more. Bounded here it withdraws
    -- exactly the escalations the suppression swallowed.
    --
    -- `distinct` because a founder can hold both rows for one session — added
    -- after the warning, so their start+10 escalation was never suppressed.
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

COMMENT ON FUNCTION public.coach_mark_arrival IS 'Mark a coach arrived (or running late) and tell the people who need to know. p_source records which of the three doors the tap came through — ''tap'' in the app, ''push'' on the notification button, ''wa'' from WhatsApp — so we can see whether the notification is carrying its share.';

-- The drop took the old signature's grants with it.
grant execute on function public.coach_mark_arrival(uuid, boolean, text) to authenticated;
grant execute on function public.coach_mark_arrival(uuid, boolean, text) to service_role;
