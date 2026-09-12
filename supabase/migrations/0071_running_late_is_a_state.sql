-- "Running late" becomes state the system can read, instead of a message it
-- only forwards.
--
-- The defect: coach_mark_arrival(p_late => true) wrote NOTHING to
-- class_sessions. It sent the parents and the founder a "Coach X is running a
-- few minutes late" notification and returned. Every other surface therefore
-- still saw a session whose coach had said nothing at all:
--
--   * sweepFounderEscalations (supabase/functions/notify) fires
--     `ops_coach_not_arrived` at start+10 for any session with
--     coach_arrived_at IS NULL, and picks its copy off coach_confirmed_at. A
--     coach who tapped "Running late" — and only that — had neither column set,
--     so the founder was told the coach "never responded at all today — likely
--     a no-show, act now", minutes after being told that same coach was running
--     late. The alarming message was the false one.
--   * the T-30 nudge and the T-10 `ops_coach_unconfirmed` escalation both
--     filter on coach_confirmed_at IS NULL, so a coach who answered the arrival
--     prompt could still be chased for not confirming.
--
-- Fix: one nullable column, stamped by the late branch, plus the confirmation
-- stamp that "I am on my way, just late" plainly implies. Additive and
-- backfill-free — existing rows are correctly NULL, because we genuinely do not
-- know whether those coaches ever reported lateness.

alter table class_sessions
  add column if not exists coach_late_at timestamptz;

comment on column class_sessions.coach_late_at is
  'When the coach reported they were running late (WhatsApp "Running late", the '
  'push action, the session screen, or the assistant). Independent of '
  'coach_arrived_at: a coach can report lateness and then arrive, and both '
  'timestamps stay true. NULL means no lateness was ever reported, which is not '
  'the same as "on time".';

-- Same 4-arg signature as 0049; only the p_late branch changes.
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

  v_location := coalesce(class_location_label(v_class), 'the venue');

  v_time := to_char(v_starts at time zone 'Asia/Kolkata', 'FMHH12:MI AM');

  if p_late then
    -- Late implies coming, exactly as arrived does. Recording BOTH is what
    -- stops the founder escalation calling this coach silent, and stops the
    -- confirm ladder chasing someone who has already answered.
    -- coach_arrived_at is deliberately untouched: they are not there yet, and
    -- the start+10 escalation still needs to fire if they never turn up. It
    -- just has to say something true when it does.
    update class_sessions
       set coach_late_at      = coalesce(coach_late_at, now()),
           coach_confirmed_at = coalesce(coach_confirmed_at, now())
     where id = p_session;
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
  to authenticated;

-- coach_undo_arrival deliberately does NOT clear coach_late_at. Undo means "I
-- am not there yet after all", which leaves a reported lateness true rather
-- than retracting it.
