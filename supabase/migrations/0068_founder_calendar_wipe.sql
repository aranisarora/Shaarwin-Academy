-- Two things the founder could not do from the admin at all.
--
-- (1) END A WEEKLY PRIVATE SLOT. `cancel_private_series` already exists and it
--     already permits founders — but it is the CLIENT's function. Its whole
--     cancellation body is `perform cancel_booking(r.id)` per future week, and
--     cancel_booking writes 'cancelled_by_client', messages only the COACH with
--     "was cancelled by the client" once per week, tells the family nothing at
--     all, and refunds only outside the cancellation window. Pointed at an
--     academy decision it therefore blames the family for it, burns this week's
--     minutes, and — because 'cancelled_by_client' is in
--     ops_notify_booking_status's list while 'cancelled_by_academy' is
--     deliberately not (see the comment at that function) — fires an
--     ops_cancellation per booking as well. Both that type and
--     session_cancelled are TRANSACTIONAL in the notify worker: no prefs, no
--     quiet hours, no daily cap. Eighteen live series across a four-week horizon
--     is some seventy uncapped pushes at whatever hour the button was tapped.
--     That is the Jul 22 mass-reassignment burst again, with cancellations.
--
-- (2) CLEAR THE WHOLE CALENDAR. Everything the app can do today is one PostgREST
--     call per step, so a clear-out that dies halfway leaves cancelled sessions,
--     messages already queued, and most of the classes still on the list —
--     `bulkRemoveClassesCore` ships that outcome as a sentence today. Over a
--     whole calendar it is near-certain under any transient error. Two of the
--     required steps are also impossible from the app at any size: `notifications`
--     has no DELETE policy (INSERT/UPDATE/SELECT only), so reminders queued for
--     sessions that are about to stop existing cannot be cleaned up; and the
--     `authenticated` role carries statement_timeout=8s.
--
-- Both new functions are SECURITY DEFINER and both check is_founder() in the
-- body, because SECURITY DEFINER bypasses RLS — the guard cannot live in a policy.

-- ── 1. End one weekly private slot, as the academy ──────────────────────────
--
-- Emits NO notifications, on purpose. The caller collapses recipients across
-- every slot AND every group class in the same operation down to one message per
-- person; returning the ids is what makes that possible. A function that
-- messaged for itself could not be combined with anything.
create or replace function public.end_private_series_as_academy(p_series uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_series    private_booking_series%rowtype;
  v_cancelled int := 0;
  v_refunded  int := 0;
  v_minutes   int := 0;
  v_clients   uuid[] := '{}';
  v_coaches   uuid[] := '{}';
begin
  if not is_founder() then
    raise exception 'not_authorised';
  end if;

  select * into v_series from private_booking_series where id = p_series;
  if not found then
    raise exception 'series_not_found';
  end if;

  -- Retire the template FIRST. generate_private_sessions loops `where active`
  -- and pg_cron runs it nightly, so a failure anywhere below this line leaves a
  -- dormant series — safe, and re-runnable — rather than a live one that refills
  -- tonight the very weeks we are about to cancel. Deactivation, not deletion:
  -- the partial unique index private_booking_series_one_active is on
  -- (player_id, weekday, start_time) WHERE active, so this also frees the slot
  -- to be set up again.
  update private_booking_series
     set active = false, cancelled_at = now()
   where id = p_series;

  drop table if exists _pbs_doomed;
  create temp table _pbs_doomed on commit drop as
    select b.id as booking_id, b.client_id,
           cs.id as session_id, cs.coach_id,
           c.duration_minutes
      from bookings b
      join class_sessions cs on cs.id = b.session_id
      join classes c on c.id = cs.class_id
     where b.private_series_id = p_series
       and b.status in ('confirmed', 'waitlisted')
       and cs.starts_at > now();

  -- A full refund for every week, including one inside the cancellation window.
  -- cancel_booking withholds that refund because a family cancelling late has
  -- already cost the coach the evening. The academy ending its own slot has not.
  insert into private_credit_ledger (client_id, booking_id, delta_minutes, reason, note)
  select d.client_id, d.booking_id, d.duration_minutes, 'cancellation_refund',
         'weekly private slot ended by the academy'
    from _pbs_doomed d
   where d.client_id is not null;
  get diagnostics v_refunded = row_count;

  select coalesce(sum(duration_minutes), 0) into v_minutes
    from _pbs_doomed where client_id is not null;

  -- 'cancelled_by_academy' is the one status ops_notify_booking_status ignores.
  -- That is the reason this is a set-based UPDATE and not a loop over
  -- cancel_booking: it is what stops the founder's own phone taking one
  -- ops_cancellation per week per family.
  update bookings b
     set status = 'cancelled_by_academy',
         cancelled_at = now(),
         cancel_reason = 'weekly slot ended'
    from _pbs_doomed d
   where b.id = d.booking_id;
  get diagnostics v_cancelled = row_count;

  update class_sessions cs
     set status = 'cancelled', cancel_reason = 'weekly slot ended'
    from _pbs_doomed d
   where cs.id = d.session_id;

  -- Reminders already queued for hours that will not happen. Only reachable
  -- from in here: notifications has no DELETE policy for the app to use.
  delete from notifications n
   where n.status = 'pending'
     and n.data ? 'session_id'
     and n.data->>'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (n.data->>'session_id')::uuid in (select session_id from _pbs_doomed);

  select coalesce(array_agg(distinct client_id) filter (where client_id is not null), '{}'),
         coalesce(array_agg(distinct coach_id)  filter (where coach_id  is not null), '{}')
    into v_clients, v_coaches
    from _pbs_doomed;

  return jsonb_build_object(
    'cancelled',        v_cancelled,
    'refunded',         v_refunded,
    'minutes_returned', v_minutes,
    'client_ids',       to_jsonb(v_clients),
    'coach_ids',        to_jsonb(v_coaches),
    'weekday',          v_series.weekday,
    'start_time',       v_series.start_time::text
  );
end;
$function$;

revoke all on function public.end_private_series_as_academy(uuid) from public, anon;
grant execute on function public.end_private_series_as_academy(uuid) to authenticated;

-- ── 2. Drop the pending reminders for a set of classes ──────────────────────
--
-- The app-side bulk remove needs this before it deletes. bookings.session_id is
-- ON DELETE CASCADE, so the booking disappears with its class while the pending
-- 'reminder_upcoming' row that names it survives at status='pending' and goes
-- out later as "Later today: <class>" for a class that no longer exists.
create or replace function public.purge_pending_session_reminders(p_class_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int;
begin
  if not is_founder() then raise exception 'not_authorised'; end if;
  if p_class_ids is null or array_length(p_class_ids, 1) is null then return 0; end if;

  delete from notifications n
   where n.status = 'pending'
     and n.data ? 'session_id'
     and n.data->>'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (n.data->>'session_id')::uuid in (
       select s.id from class_sessions s where s.class_id = any(p_class_ids)
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.purge_pending_session_reminders(uuid[]) from public, anon;
grant execute on function public.purge_pending_session_reminders(uuid[]) to authenticated;

-- ── 3. Clear the whole calendar, in one transaction ─────────────────────────
--
-- The one operation in this app that is a single RPC rather than a sequence of
-- PostgREST calls, for the reason in the header: every step of the TypeScript
-- version is its own transaction, and half a wipe is the worst state the
-- calendar can be in. Here it either all happens or none of it does.
create or replace function public.wipe_calendar(
  p_scope        text    default 'all',    -- 'all' | 'group' | 'private'
  p_confirm      text    default null,     -- must be exactly 'WIPE'
  p_keep_history boolean default false     -- true = end everything, delete nothing
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
set lock_timeout to '30s'
as $function$
declare
  v_doomed    uuid[];
  v_classes   int := 0;
  v_series    int := 0;
  v_gseries   int := 0;
  v_sessions  int := 0;
  v_bookings  int := 0;
  v_minutes   int := 0;
  v_credits   int := 0;
  v_msgs      int := 0;
  v_coach_msgs int := 0;
  v_reminders int := 0;
begin
  if not is_founder() then
    raise exception 'not_authorised';
  end if;
  -- A typed token, not a boolean. The entire guard is that this string cannot
  -- be produced by a mis-tap on a phone.
  if p_confirm is distinct from 'WIPE' then
    raise exception 'confirm_required';
  end if;
  if p_scope not in ('all', 'group', 'private') then
    raise exception 'bad_scope';
  end if;

  select coalesce(array_agg(id), '{}') into v_doomed
    from classes
   where (p_scope = 'all'
       or (p_scope = 'group'   and class_type = 'group')
       or (p_scope = 'private' and class_type = 'private'));
  v_classes := coalesce(array_length(v_doomed, 1), 0);

  -- (a) Retire the templates BEFORE anything else. private_booking_series has no
  --     FK to classes at all, so deleting every class would leave every live
  --     series standing, and the nightly generator would put the weeks back the
  --     same night — each with a fresh coach assignment and a fresh minutes
  --     debit. booking_series is reached only by CASCADE, so a group standing
  --     booking would otherwise be destroyed without its holder ever hearing.
  if p_scope in ('all', 'private') then
    update private_booking_series set active = false, cancelled_at = now() where active;
    get diagnostics v_series = row_count;
  end if;
  if p_scope in ('all', 'group') then
    update booking_series set active = false, cancelled_at = now()
     where active and class_id = any(v_doomed);
    get diagnostics v_gseries = row_count;
  end if;

  -- (b) What is actually being taken away from people, captured once so every
  --     step below agrees about who is affected.
  drop table if exists _wipe_doomed;
  create temp table _wipe_doomed on commit drop as
    select b.id as booking_id, b.client_id,
           cs.id as session_id, cs.coach_id,
           c.class_type, c.duration_minutes
      from bookings b
      join class_sessions cs on cs.id = b.session_id
      join classes c on c.id = cs.class_id
     where c.id = any(v_doomed)
       and b.status in ('confirmed', 'waitlisted')
       and cs.starts_at > now();

  -- (c) Give back what was paid for. The private ledger's -duration debit is
  --     written by _create_private_occurrence with booking_id NULL, so it
  --     survives a cascade untouched and cannot be found from the booking side
  --     afterwards — the compensating row has to be written here, before the
  --     delete, or the family is simply out the minutes.
  insert into private_credit_ledger (client_id, booking_id, delta_minutes, reason, note)
  select d.client_id, d.booking_id, d.duration_minutes, 'cancellation_refund',
         'calendar cleared'
    from _wipe_doomed d
   where d.client_id is not null and d.class_type = 'private';

  select coalesce(sum(duration_minutes), 0) into v_minutes
    from _wipe_doomed where client_id is not null and class_type = 'private';

  -- A group trial/drop-in credit is burned by consumed_at, and
  -- class_credits.booking_id is ON DELETE SET NULL — so a cascade would leave it
  -- burned with nothing left to point at. Hand it back.
  update class_credits
     set consumed_at = null, booking_id = null
   where booking_id in (select booking_id from _wipe_doomed);
  get diagnostics v_credits = row_count;

  -- (d) Cancel, as the academy.
  update bookings b
     set status = 'cancelled_by_academy',
         cancelled_at = now(),
         cancel_reason = 'calendar cleared'
    from _wipe_doomed d
   where b.id = d.booking_id;
  get diagnostics v_bookings = row_count;

  update class_sessions cs
     set status = 'cancelled', cancel_reason = 'calendar cleared'
   where cs.class_id = any(v_doomed)
     and cs.status = 'scheduled'
     and cs.starts_at > now();
  get diagnostics v_sessions = row_count;

  -- An hour that already came and went with no register marked is settled as
  -- completed, not cancelled — it genuinely did happen, and inventing a
  -- cancellation for it would be as much of a lie as inventing attendance. Same
  -- cut the class-ending path uses: ends_at, so a session that is halfway
  -- through right now is left alone rather than taken off a coach's screen
  -- while he is standing in the hall.
  update class_sessions
     set status = 'completed'
   where class_id = any(v_doomed) and status = 'scheduled' and ends_at < now();

  -- (e) ONE message per person. An INSERT..SELECT..GROUP BY cannot send twice;
  --     there is no loop here to get this wrong.
  insert into notifications (user_id, type, title, body, data)
  select d.client_id, 'session_cancelled',
         'Your sessions are cancelled',
         'We have cleared the schedule. Your ' || count(*) ||
         case when count(*) = 1 then ' upcoming session is' else ' upcoming sessions are' end ||
         ' cancelled' ||
         case when sum(case when d.class_type = 'private' then d.duration_minutes else 0 end) > 0
              then ', and ' || sum(case when d.class_type = 'private' then d.duration_minutes else 0 end) ||
                   ' private minutes are back on your account'
              else '' end ||
         '. Nothing for you to do — we will be in touch when the new timetable is up.',
         jsonb_build_object('url', '/app/schedule',
                            'session_count', count(*),
                            'collapsed', true)
    from _wipe_doomed d
   where d.client_id is not null
   group by d.client_id;
  get diagnostics v_msgs = row_count;

  insert into notifications (user_id, type, title, body, data)
  select d.coach_id, 'session_cancelled',
         'Your upcoming sessions are cancelled',
         'The schedule has been cleared. ' || count(*) ||
         case when count(*) = 1 then ' session is' else ' sessions are' end ||
         ' off your calendar. Nothing for you to do.',
         jsonb_build_object('url', '/coach',
                            'session_count', count(*),
                            'collapsed', true)
    from _wipe_doomed d
   where d.coach_id is not null
   group by d.coach_id;
  get diagnostics v_coach_msgs = row_count;

  -- (f) Reminders for hours that will not exist in a moment.
  delete from notifications n
   where n.status = 'pending'
     and n.data ? 'session_id'
     and n.data->>'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (n.data->>'session_id')::uuid in (
       select s.id from class_sessions s where s.class_id = any(v_doomed)
     );
  get diagnostics v_reminders = row_count;

  -- (g) The delete itself, LAST, so that every crash point above leaves a
  --     recoverable calendar rather than a half-deleted one. classes ->
  --     class_sessions -> bookings and classes -> private_class_details are all
  --     ON DELETE CASCADE. Venues are deliberately untouched: a venue is a
  --     place, not a calendar entry, and classes_venue_id_fkey is the one
  --     NO ACTION foreign key in this graph — removing venues here would fail
  --     against any class that survived.
  if p_keep_history then
    update classes set active = false, ends_on = current_date where id = any(v_doomed);
  else
    delete from classes where id = any(v_doomed);
  end if;

  -- (h) audit_log has no FK to the entity it names and no DELETE policy, so it
  --     outlives everything above. After a wipe it is the ONLY surviving record
  --     of what the calendar contained — so it carries the ids, not just counts.
  insert into audit_log (actor_id, action, entity, meta)
  values (auth.uid(), 'calendar.wipe', 'classes',
          jsonb_build_object(
            'scope', p_scope, 'keep_history', p_keep_history,
            'classes', v_classes, 'class_ids', to_jsonb(v_doomed),
            'private_series_retired', v_series, 'group_series_retired', v_gseries,
            'sessions_cancelled', v_sessions, 'bookings_cancelled', v_bookings,
            'minutes_returned', v_minutes, 'credits_returned', v_credits,
            'clients_messaged', v_msgs, 'coaches_messaged', v_coach_msgs,
            'reminders_dropped', v_reminders));

  return jsonb_build_object(
    'classes', v_classes, 'private_series', v_series, 'group_series', v_gseries,
    'sessions', v_sessions, 'bookings', v_bookings, 'minutes_returned', v_minutes,
    'credits_returned', v_credits, 'clients_messaged', v_msgs,
    'coaches_messaged', v_coach_msgs, 'reminders_dropped', v_reminders,
    'kept_history', p_keep_history);
end;
$function$;

revoke all on function public.wipe_calendar(text, text, boolean) from public, anon;
grant execute on function public.wipe_calendar(text, text, boolean) to authenticated;

-- ── 4. Pin the one SECURITY DEFINER function missing a search_path ──────────
--
-- Every other SECURITY DEFINER function in this schema sets it. This one does
-- not, and it is the only DELETE trigger anywhere in the class graph — deleting
-- a private_class_details row deletes the whole class behind it, as the
-- definer, around every app-level guard. Body unchanged; this closes the
-- search_path hole only.
create or replace function public._delete_class_on_private_details_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from classes where id = old.class_id;
  return old;
end;
$function$;
