-- Two notification types never said which session they were about.
--
--   coach_changed     "One of your sessions was moved to another coach."
--   reminder_upcoming title "Later today", body "Private session"
--
-- In both cases `data.session_id` was already on the row — the session was
-- known, it just never reached the sentence. The reminder is the worse of the
-- two: it is the message a parent acts on, and it named neither the venue nor
-- (for a private) anything more useful than the words "Private session".
--
-- ── Why a trigger, and not the eight writers ────────────────────────────────
--
-- `notifications.body` is frozen at INSERT (notifications.md §5), so the fix
-- has to live wherever the row is written. For these two types that is EIGHT
-- places, and — the part that matters — two of them are TypeScript, not SQL:
-- `lib/admin-ops-calendar.ts` inserts reminders directly. That split is exactly
-- what let the location bug hide for a day the last time round.
--
-- A BEFORE INSERT trigger is the one place all eight paths pass through. It
-- also repairs the rows that are inserted by future writers nobody has thought
-- of yet, which is the failure mode this file exists to close.
--
-- It deliberately does NOT touch any other type: the guard on the first line is
-- the whole performance story, and every other notification composes a body
-- that already says what it means.

-- ── 1. One name for a session, used by both branches ────────────────────────
-- "Beginners Batch, Sat 12 Jul, 6:30 pm at Adarsh Palm Retreat Villas, Clubhouse"
--
-- Location comes from `class_location_label`, the single resolver (§5) — never
-- from an address string, and never from a distance guess.

CREATE OR REPLACE FUNCTION public.session_label(p_session uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.title || ', ' || fmt_ist(s.starts_at)
         || coalesce(' at ' || nullif(class_location_label(c.id), ''), '')
  from class_sessions s
  join classes c on c.id = s.class_id
  where s.id = p_session;
$function$;

COMMENT ON FUNCTION public.session_label IS
  'Human name for a session: title, IST start, and location_label. Used by the '
  'notify_name_the_session trigger so a message never says "one of your sessions".';

-- ── 2. The trigger ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_name_the_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session uuid;
  v_label   text;
  v_title   text;
  v_time    text;
  v_where   text;
  v_coach   uuid;
  v_coach_name text;
begin
  if new.type not in ('reminder_upcoming', 'coach_changed') then
    return new;
  end if;

  v_session := nullif(new.data ->> 'session_id', '')::uuid;
  if v_session is null then return new; end if;

  select c.title,
         to_char(s.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
         nullif(class_location_label(c.id), ''),
         s.coach_id
    into v_title, v_time, v_where, v_coach
  from class_sessions s
  join classes c on c.id = s.class_id
  where s.id = v_session;

  if v_title is null then return new; end if;   -- session vanished; leave as-is

  if new.type = 'reminder_upcoming' then
    -- A private's class row is literally titled "Private session", which tells a
    -- parent nothing they didn't know. The venue is the useful part, so lead
    -- with the time and let the location carry the identity.
    new.body := v_title || ' at ' || v_time
                || coalesce(' — ' || v_where, '') || '.';
    new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
      'class_title',  v_title,
      'time_str',     v_time,
      'location_str', v_where));
    return new;
  end if;

  -- coach_changed. The caller's sentence stays as the lead ("Your session has a
  -- new coach"); this appends the session it is talking about.
  v_label := v_title || ', ' || fmt_ist(
    (select starts_at from class_sessions where id = v_session))
    || coalesce(' at ' || v_where, '');

  new.body := rtrim(new.body, ' .') || ' — ' || v_label || '.';

  -- Whoever is NOT the coach wants to know who the coach now is. That covers
  -- the parent ("Meet your new coach" never named them) and the dropped coach.
  if v_coach is not null and v_coach <> new.user_id then
    select split_part(nullif(btrim(full_name), ''), ' ', 1)
      into v_coach_name from profiles where id = v_coach;
    if v_coach_name is not null then
      new.body := new.body || ' New coach: ' || v_coach_name || '.';
    end if;
  end if;

  new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
    'class_title',   v_title,
    'time_str',      v_time,
    'location_str',  v_where,
    'session_label', v_label,
    'coach_name',    v_coach_name));

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS notifications_name_the_session ON public.notifications;
CREATE TRIGGER notifications_name_the_session
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION notify_name_the_session();

-- ── 3. The collapsed body ───────────────────────────────────────────────────
--
-- `queue_coach_changed` collapses same-day repeats into one row because a bulk
-- reassignment once sent 376 messages (migration 0043). The collapse is right
-- and stays. What was wrong is that it threw away the detail the trigger above
-- has just built: the summary read "2 of your sessions have a new coach", which
-- names nothing at all.
--
-- The collapse runs as an UPDATE, so the BEFORE INSERT trigger does not fire on
-- it — the first row's label is stashed in `data.session_label` (by the trigger)
-- and reused here.

CREATE OR REPLACE FUNCTION public.queue_coach_changed(p_user uuid, p_session uuid, p_title text, p_body text, p_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing notifications%rowtype;
  v_count int;
  v_day_start timestamptz;
  v_first text;
begin
  if p_user is null then return; end if;

  -- Start of the current IST day. India has no DST so this is unambiguous.
  v_day_start := date_trunc('day', now() at time zone 'Asia/Kolkata')
                 at time zone 'Asia/Kolkata';

  select * into v_existing
  from notifications
  where user_id = p_user
    and type = 'coach_changed'
    and status = 'pending'
    and created_at >= v_day_start
  order by created_at
  limit 1
  for update;

  if not found then
    -- notify_name_the_session appends the session to the body on the way in.
    insert into notifications (user_id, type, title, body, data, scheduled_for)
    values (p_user, 'coach_changed', p_title, p_body,
            jsonb_build_object('session_id', p_session, 'url', p_url,
                               'change_count', 1),
            now() + interval '2 minutes');
    return;
  end if;

  -- Second and subsequent changes today → one summary instead of N messages.
  v_count := coalesce((v_existing.data ->> 'change_count')::int, 1) + 1;
  v_first := v_existing.data ->> 'session_label';

  update notifications
  set title = 'Schedule updated',
      body  = case
                when v_first is null then
                  'Your schedule was updated — ' || v_count
                  || ' of your sessions have a new coach.'
                else
                  v_first || ' and ' || (v_count - 1)
                  || case when v_count - 1 = 1 then ' other session'
                          else ' other sessions' end
                  || ' have a new coach.'
              end,
      data  = v_existing.data
              || jsonb_build_object('change_count', v_count,
                                    'url', p_url,
                                    'collapsed', true),
      scheduled_for = greatest(v_existing.scheduled_for, now() + interval '2 minutes')
  where id = v_existing.id;
end;
$function$;

COMMENT ON FUNCTION public.queue_coach_changed IS
  'Queue a coach_changed notification, collapsing repeats for the same user on '
  'the same IST day into one summary row that names the first session and counts '
  'the rest. The per-session wording is added by notify_name_the_session.';

-- ── 4. Cover offers carry directions ────────────────────────────────────────
--
-- A cover offer is the one message where the recipient has never been to the
-- venue — that is the whole point of it. It carried class_title, time_str and
-- location_str but no maps_url, so the coach_cover_offer template had nothing to
-- put in its directions slot.
--
-- The body also still said only 'reply "claim"'. That stays (it is what the
-- plain-text and in-app paths show, and typing still works) but now names the
-- button too, since the template has one.

CREATE OR REPLACE FUNCTION public.offer_cover_session(p_session uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_when    text;
  v_where   text;
  v_maps    text;
  v_count   int := 0;
  r record;
begin
  select * into v_session from class_sessions where id = p_session;
  if not found or v_session.status <> 'scheduled' then return 0; end if;
  if v_session.coach_id is not null then return 0; end if;
  if v_session.starts_at <= now() then return 0; end if;

  select * into v_class from classes where id = v_session.class_id;

  v_where := coalesce(class_location_label(v_session.class_id), 'the venue');
  v_maps  := class_location_maps_url(v_session.class_id);

  v_when := fmt_ist(v_session.starts_at);

  for r in select rc.coach_id from rank_coaches(p_session) rc limit 10
  loop
    if exists (
      select 1 from notifications
      where type = 'cover_offer'
        and user_id = r.coach_id
        and data->>'session_id' = p_session::text
    ) then
      continue;
    end if;

    insert into notifications (user_id, type, title, body, data)
    values (r.coach_id, 'cover_offer', 'Cover needed',
      coalesce(v_class.title, 'A session') || ' on ' || v_when || ' at ' || v_where
      || ' needs a coach. First to claim it takes it — tap Claim, or reply "claim".',
      jsonb_strip_nulls(jsonb_build_object('session_id', p_session,
                         'class_title', coalesce(v_class.title, 'a session'),
                         'time_str', v_when,
                         'location_str', v_where,
                         'maps_url', v_maps,
                         'url', '/coach/calendar')));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;
