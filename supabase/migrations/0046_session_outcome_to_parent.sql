-- notification-fix-plan Phase 3 item 1 (C11 / M1) — tell the parent how the
-- session went.
--
-- Today `ops_notify_booking_status` handles `no_show` by calling
-- notify_founders and nothing else. A child booked into Beginners Batch who
-- never walks in produces an /admin feed row and TOTAL SILENCE to the parent,
-- who believes their child is at the table. The audit caught this live: a
-- parent asked the bot "Where is he?" mid-day and the bot had nothing to answer
-- with, because no message of this kind exists.
--
-- This is the only message in the plan that is a safety concern rather than a
-- marketing one. Two outcomes, one message per (player, session):
--
--   player_absent    — TRANSACTIONAL (ignores prefs) and never deferred.
--                      Delay defeats the entire point.
--   session_outcome  — the positive counterpart, carrying the coach's note when
--                      there is one. Mutable under the "Progress" toggle: a
--                      parent of three who's happy with the arrangement
--                      shouldn't be forced to hear about every session, and
--                      unlike an absence, nothing is at risk if they don't.
--
-- Deliberately preserved: attendance auto-marked by the sweep (auth.uid() is
-- null) still stays silent. An automated guess is not a good enough basis for
-- telling a parent their child went missing — only a coach or founder marking
-- it counts.

CREATE OR REPLACE FUNCTION public.ops_notify_booking_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_player  text;
  v_client  text;
  v_who     text;
  v_first   text;
  v_when    text;
  v_note    text;
begin
  if old.status = new.status then return new; end if;
  -- cancelled_by_academy is founder-initiated (already knows); rescheduled is
  -- reported by the paired new booking's insert.
  if new.status not in ('cancelled_by_client', 'attended', 'no_show', 'confirmed') then
    return new;
  end if;
  -- attendance auto-marked by the sweep (no acting user) stays silent
  if new.status in ('attended', 'no_show') and auth.uid() is null then return new; end if;
  -- only waitlist→confirmed promotions are interesting among confirms
  if new.status = 'confirmed' and old.status <> 'waitlisted' then return new; end if;

  select * into v_session from class_sessions where id = new.session_id;
  if not found then return new; end if;
  select * into v_class from classes where id = v_session.class_id;
  select full_name into v_player from players where id = new.player_id;
  select full_name into v_client from profiles where id = new.client_id;
  v_who := coalesce(v_client, 'A client')
    || case when v_player is not null and v_player <> v_client then ' (' || v_player || ')' else '' end;

  v_first := split_part(coalesce(nullif(trim(v_player), ''), 'Your player'), ' ', 1);
  v_when  := fmt_ist(v_session.starts_at);

  if new.status = 'cancelled_by_client' then
    perform notify_founders('ops_cancellation', 'Booking cancelled',
      v_who || ' cancelled ' || v_class.title
      || ' — ' || fmt_ist(v_session.starts_at)
      || coalesce('. Reason: ' || nullif(new.cancel_reason, ''), '') || '.',
      jsonb_build_object('booking_id', new.id, 'session_id', new.session_id,
                         'client_id', new.client_id, 'url', '/admin/calendar'));
  elsif new.status = 'attended' then
    perform notify_founders('ops_attendance', 'Attendance marked',
      coalesce(v_player, 'A player') || ' attended ' || v_class.title
      || ' (' || fmt_ist(v_session.starts_at) || ').',
      jsonb_build_object('booking_id', new.id, 'session_id', new.session_id, 'url', '/admin/calendar'));

    -- C11 positive. "What was worked on" comes from the coach's note for this
    -- player, if they wrote one after the session started — so the message
    -- carries real substance when it exists and degrades to a clean
    -- confirmation when it doesn't.
    select body into v_note
      from student_notes
     where player_id = new.player_id
       and author_id = v_session.coach_id
       and created_at >= v_session.starts_at
     order by created_at desc
     limit 1;

    if new.client_id is not null then
      insert into notifications (user_id, type, title, body, data)
      values (new.client_id, 'session_outcome',
        v_first || ' was at ' || v_class.title,
        v_first || ' attended ' || v_class.title || ' (' || v_when || ').'
        || coalesce(' Coach''s note: ' || nullif(trim(v_note), ''), ''),
        jsonb_build_object('booking_id', new.id, 'session_id', new.session_id,
                           'player_id', new.player_id,
                           'player_name', v_first,
                           'class_title', v_class.title,
                           'time_str', v_when,
                           'coach_note', nullif(trim(v_note), ''),
                           'url', '/app/players'));
    end if;

  elsif new.status = 'no_show' then
    perform notify_founders('ops_attendance', 'No-show',
      coalesce(v_player, 'A player') || ' did NOT show for ' || v_class.title
      || ' (' || fmt_ist(v_session.starts_at) || ').',
      jsonb_build_object('booking_id', new.id, 'session_id', new.session_id, 'url', '/admin/calendar'));

    -- C11 / M1 — the message this whole item exists for. Copy is deliberately
    -- non-accusatory and opens a reply channel: the parent may know something
    -- we don't, and the marking may simply be wrong.
    if new.client_id is not null then
      insert into notifications (user_id, type, title, body, data)
      values (new.client_id, 'player_absent',
        v_first || ' wasn''t at today''s class',
        'We marked ' || v_first || ' absent for ' || v_class.title || ' (' || v_when
        || '). If that''s a mistake or something''s up, just reply here — we''ll sort it.',
        jsonb_build_object('booking_id', new.id, 'session_id', new.session_id,
                           'player_id', new.player_id,
                           'player_name', v_first,
                           'class_title', v_class.title,
                           'time_str', v_when,
                           'url', '/app/schedule'));
    end if;

  else -- waitlisted → confirmed
    perform notify_founders('ops_booking', 'Waitlist spot claimed',
      v_who || ' claimed the freed spot in ' || v_class.title
      || ' — ' || fmt_ist(v_session.starts_at) || '.',
      jsonb_build_object('booking_id', new.id, 'session_id', new.session_id,
                         'client_id', new.client_id, 'url', '/admin/calendar'));
  end if;
  return new;
end;
$function$;
