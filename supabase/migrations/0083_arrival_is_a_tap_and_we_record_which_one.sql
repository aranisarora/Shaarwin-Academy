-- Arrival is a tap. Record which of the three places it came from.
--
-- The geofence is gone (see the commit that removes useAutoArrival). It marked
-- one session in a day of production, because the only time it could run was
-- while the app was open — and a coach with the app open can press the button.
-- The case it was built for, the app closed at the venue, is unreachable from a
-- browser: geolocation is not exposed to a service worker anywhere, and the
-- Geofencing API that would have done it was specced, shipped behind a Chrome
-- flag, and removed.
--
-- What already covers that case is the "I've arrived" button on the push
-- notification. It marks arrival from the lock screen through this same RPC and
-- needs no permission. Until now it passed p_source => 'tap', with a comment in
-- app/api/push-action/route.ts saying a fourth value "would mean a migration for
-- a distinction nothing reads". The distinction is now the thing we most want to
-- read: whether coaches answer from the tray or from inside the app tells us
-- whether the notification is doing its job, and that is the question the
-- geofence was the wrong answer to.
--
-- So:
--   • 'push' joins the source check. 'auto' stays in it — one production row
--     was written by the geofence before it was removed, and rewriting history
--     to tidy a constraint is worse than a value nothing writes.
--   • p_distance_m goes. It existed only to choose a fence width. The
--     coach_arrival_distance_m COLUMN is deliberately left in place: dropping it
--     changes founder_day_report's RETURNS TABLE signature and both
--     app/admin/schedule readers, which is a wide, conflict-prone change for no
--     functional gain. Nothing writes it after this migration.
--   • the 'auto' two-minute parent-notification delay goes with it. It bought an
--     Undo window against a mark the coach never made; every remaining source is
--     a deliberate tap, and parents should hear immediately.
--
-- NOTE FOR WHOEVER APPLIES THIS. Production's coach_mark_arrival is currently
-- *older* than supabase/schema.sql: it has neither `v_won` nor the
-- `where coach_arrived_at is null` guard, which means
-- 0079_arrival_notifies_once.sql was never applied there. (There are two
-- migrations numbered 0079; the venues one did reach production, this one did
-- not.) This file is written against schema.sql, so applying it also lands that
-- fix — the one that stops two callers writing every booked parent the same
-- message twice. That is intended, and worth knowing before you run it.

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

-- ── The RPC, minus the fence ────────────────────────────────────────────────
-- Dropped rather than replaced: p_distance_m had a default, so leaving the
-- four-argument version in place would make every three-argument call ambiguous.
drop function if exists public.coach_mark_arrival(uuid, boolean, text, integer);

create or replace function public.coach_mark_arrival(
  p_session uuid,
  p_late boolean default false,
  p_source text default 'tap'
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
  -- three entry points to one question invite (0079).
  if not v_won then
    select coach_arrived_at into v_arrived from class_sessions where id = p_session;
    return v_arrived;
  end if;

  -- Booked clients (parents) are always told — arrived or late both matter to
  -- them. Immediately, in every case: the two-minute hold here existed so an
  -- Undo could beat delivery of an arrival the coach had not asked for, and
  -- every source left is a deliberate tap. Data carries
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
           jsonb_build_object('session_id', p_session, 'url', '/admin/schedule')
      from profiles p where p.role = 'founder';
  else
    -- Close the loop on an escalation this arrival has just made untrue (0079).
    -- Only the founders who were actually told, and only once — a second
    -- arrival never wins the transition above, so it cannot reach here.
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

comment on function public.coach_mark_arrival is
  'Mark a coach arrived (or running late) and tell the people who need to know. p_source records which of the three doors the tap came through — ''tap'' in the app, ''push'' on the notification button, ''wa'' from WhatsApp — so we can see whether the notification is carrying its share.';

grant execute on function public.coach_mark_arrival(uuid, boolean, text) to authenticated;
grant execute on function public.coach_mark_arrival(uuid, boolean, text) to service_role;
