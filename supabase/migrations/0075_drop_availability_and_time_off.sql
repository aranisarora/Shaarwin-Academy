-- Weekly availability windows and time-off requests, removed.
--
-- Both were coach-declared state that the assignment engine treated as a hard
-- filter, and neither earned its keep. Every coach was seeded 10:00–22:00 seven
-- days a week (seed_default_coach_availability) and nobody narrowed it, so the
-- window check only ever fired as a false negative — a coach who had edited
-- their hours once, months ago, silently dropped out of scoring. Time off asked
-- the founder to approve a request in a screen he had to remember to open, to
-- express something he already knew from the conversation.
--
-- The engine keeps the filters that describe facts rather than intentions:
-- `inactive` (the account is paused), `overlap` (they are already teaching then,
-- travel buffer included) and `level_too_high`. A coach who can't make a session
-- still says so — `cant_make_session` / `handle_coach_dropout` is untouched, and
-- it is the honest path: it names one session, now, and starts cover.
--
-- Consequently `coach_filter_failure` can no longer return 'time_off' or
-- 'unavailable'; the two call sites that translated those codes into English
-- (lib/admin-ops-calendar.ts, lib/whatsapp/tools/coach.ts) drop them in the same
-- commit.

-- ── 1. Hard-filter check ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.coach_filter_failure(p_coach uuid, p_session uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_coach coaches%rowtype;
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_buffer int := get_setting_int('travel_buffer_minutes', 30);
begin
  select * into v_coach from coaches where id = p_coach and active;
  if not found then return 'inactive'; end if;

  select * into v_session from class_sessions where id = p_session;
  select * into v_class from classes where id = v_session.class_id;

  -- scheduling overlap (+ travel buffer between different venues)
  if exists (
    select 1 from class_sessions s2
    join classes c2 on c2.id = s2.class_id
    where s2.coach_id = p_coach and s2.status = 'scheduled' and s2.id <> p_session
      and tstzrange(
            s2.starts_at - case when c2.venue_id is distinct from v_class.venue_id
                                then make_interval(mins => v_buffer) else interval '0' end,
            s2.ends_at   + case when c2.venue_id is distinct from v_class.venue_id
                                then make_interval(mins => v_buffer) else interval '0' end
          ) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then return 'overlap'; end if;

  return null;
end;
$function$;

-- ── 2. Private-booking slot search ──────────────────────────────────────────
-- Same shape, minus the window and time-off clauses. A slot is offerable when
-- an active coach is not already booked across it.
CREATE OR REPLACE FUNCTION public.get_bookable_slots(p_lat double precision, p_lng double precision, p_duration integer, p_player uuid, p_days integer DEFAULT 14)
 RETURNS TABLE(starts_at timestamp with time zone, coach_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with candidate_coaches as (
    select c.* from coaches c
    where c.active
  ),
  slots as (
    select generate_series(
      date_trunc('hour', now() + interval '24 hours'),
      now() + make_interval(days => p_days),
      interval '30 minutes'
    ) as slot_start
  )
  select s.slot_start, count(c.id)::int
  from slots s
  cross join candidate_coaches c
  where
    -- no overlapping scheduled session (+ buffer, conservatively applied)
    not exists (
      select 1 from class_sessions cs
      where cs.coach_id = c.id and cs.status = 'scheduled'
        and tstzrange(cs.starts_at - make_interval(mins => get_setting_int('travel_buffer_minutes', 30)),
                      cs.ends_at + make_interval(mins => get_setting_int('travel_buffer_minutes', 30)))
          && tstzrange(s.slot_start, s.slot_start + make_interval(mins => p_duration))
    )
  group by s.slot_start
  order by s.slot_start;
end;
$function$;

-- ── 3. Private reschedule — keep-the-same-coach check ───────────────────────
-- The inline hard-filter test loses the same two clauses. Overlap alone now
-- decides whether the existing coach follows the session to its new time.
CREATE OR REPLACE FUNCTION public.reschedule_private_session(p_session uuid, p_new_start timestamp with time zone, p_confirm boolean DEFAULT false)
 RETURNS TABLE(proposed_coach uuid, coach_changed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_old_coach uuid;
  v_new_coach uuid;
  v_new_end timestamptz;
  v_fail text;
begin
  select * into v_session from class_sessions where id = p_session for update;
  if not found then raise exception 'session_not_found'; end if;
  select * into v_class from classes where id = v_session.class_id;

  if not exists (
    select 1 from private_class_details d
    where d.class_id = v_class.id and d.client_id = v_client
  ) then raise exception 'not_your_session'; end if;

  if p_new_start < now() + interval '24 hours' then
    raise exception 'lead_time_24h';
  end if;

  v_old_coach := v_session.coach_id;
  v_new_end := p_new_start + make_interval(mins => v_class.duration_minutes);

  -- Same-coach first (hard filters at the new time), else engine scoring.
  if v_old_coach is not null then
    -- Temporarily test the coach against the new window via a lightweight check
    v_fail := null;
    if exists (
      select 1 from class_sessions s2
      where s2.coach_id = v_old_coach and s2.status = 'scheduled' and s2.id <> p_session
        and tstzrange(s2.starts_at, s2.ends_at) && tstzrange(p_new_start, v_new_end)
    ) then v_fail := 'overlap'; end if;
    if v_fail is null then v_new_coach := v_old_coach; end if;
  end if;

  if v_new_coach is null then
    -- score candidates for the new time by moving the window transiently
    -- (preview-safe: inside a transaction; rolled back unless confirmed)
    update class_sessions set starts_at = p_new_start, ends_at = v_new_end, coach_id = null
    where id = p_session;
    select rc.coach_id into v_new_coach from rank_coaches(p_session) rc limit 1;
    if not p_confirm then
      -- undo the transient move for preview
      update class_sessions set starts_at = v_session.starts_at, ends_at = v_session.ends_at,
        coach_id = v_old_coach where id = p_session;
      return query select v_new_coach, (v_new_coach is distinct from v_old_coach);
      return;
    end if;
  elsif not p_confirm then
    return query select v_new_coach, false;
    return;
  end if;

  if v_new_coach is null then raise exception 'no_coach_available'; end if;

  update class_sessions
  set starts_at = p_new_start, ends_at = v_new_end, coach_id = v_new_coach
  where id = p_session;

  update coach_assignments set status = 'superseded'
  where session_id = p_session and status = 'active' and coach_id is distinct from v_new_coach;
  insert into coach_assignments (session_id, coach_id, assigned_by, status)
  select p_session, v_new_coach, v_client, 'active'
  where not exists (
    select 1 from coach_assignments
    where session_id = p_session and status = 'active' and coach_id = v_new_coach
  );

  insert into notifications (user_id, type, title, body, data) values
    (v_client, 'booking_rescheduled', 'Rescheduled.',
     to_char(p_new_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am'),
     jsonb_build_object('session_id', p_session, 'url', '/app/schedule'));
  if v_old_coach is not null and v_old_coach <> v_new_coach then
    insert into notifications (user_id, type, title, body, data) values
      (v_old_coach, 'coach_changed', 'Session moved',
       'A private session was rescheduled away from you.',
       jsonb_build_object('session_id', p_session, 'url', '/coach/calendar'));
  end if;
  insert into notifications (user_id, type, title, body, data) values
    (v_new_coach, 'new_private_session', 'Private session (rescheduled)',
     to_char(p_new_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am'),
     jsonb_build_object('session_id', p_session, 'url', '/coach/session/' || p_session));

  return query select v_new_coach, (v_new_coach is distinct from v_old_coach);
end;
$function$;

-- ── 4. The seeding trigger ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS seed_coach_availability ON public.coaches;
DROP FUNCTION IF EXISTS public.seed_default_coach_availability();

-- ── 5. The tables and the enum ──────────────────────────────────────────────
-- CASCADE takes the RLS policies, indexes and constraints with them.
DROP TABLE IF EXISTS public.coach_availability CASCADE;
DROP TABLE IF EXISTS public.coach_time_off CASCADE;
DROP TYPE IF EXISTS public.time_off_status;
