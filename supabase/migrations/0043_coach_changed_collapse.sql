-- notification-fix-plan 2.1 — bulk-operation suppression for coach_changed.
--
-- On Jul 22 a single mass reassignment produced 376 `coach_changed` rows in one
-- day (188 of them to clients — "Meet your new coach", once per session).
-- Steady state is 2–9/day. The cause is structural, not a bad click: both
-- assignCoachToClass() and the coach-retirement handover loop
-- reassignSessionCore() over every upcoming session, and each call queued its
-- own notification.
--
-- Fixing the two loops would leave the next loop to rediscover this. Instead the
-- collapse lives at the queue site: queue_coach_changed() folds repeat changes
-- for the same person on the same IST day into ONE row, rewritten as a summary
-- ("3 of your sessions have a new coach"). Every caller — the two admin loops,
-- the WhatsApp founder tool, coach dropout, private reschedule — inherits it.
--
-- Two supporting details:
--   * A 2-minute scheduling delay so a burst is still `pending` when its
--     siblings arrive. coach_changed is already DEFERRABLE in the worker, so
--     the delay costs nothing.
--   * Collapse only folds `pending` rows. Anything already delivered is a
--     genuinely separate event; the per-user daily cap (2.2) is the backstop
--     for that longer tail.

-- ── The collapse helper ─────────────────────────────────────────────────────
create or replace function public.queue_coach_changed(
  p_user uuid,
  p_session uuid,
  p_title text,
  p_body text,
  p_url text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing notifications%rowtype;
  v_count int;
  v_day_start timestamptz;
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
    insert into notifications (user_id, type, title, body, data, scheduled_for)
    values (p_user, 'coach_changed', p_title, p_body,
            jsonb_build_object('session_id', p_session, 'url', p_url,
                               'change_count', 1),
            now() + interval '2 minutes');
    return;
  end if;

  -- Second and subsequent changes today → one summary instead of N messages.
  v_count := coalesce((v_existing.data ->> 'change_count')::int, 1) + 1;

  update notifications
  set title = 'Schedule updated',
      body  = 'Your schedule was updated — ' || v_count
              || ' of your sessions have a new coach.',
      data  = v_existing.data
              || jsonb_build_object('change_count', v_count,
                                    'url', p_url,
                                    'collapsed', true),
      scheduled_for = greatest(v_existing.scheduled_for, now() + interval '2 minutes')
  where id = v_existing.id;
end;
$function$;

comment on function public.queue_coach_changed is
  'Queue a coach_changed notification, collapsing repeats for the same user on the same IST day into one summary row. See notification-fix-plan 2.1.';

-- ── founder_reassign — the path the bulk admin loops go through ─────────────
CREATE OR REPLACE FUNCTION public.founder_reassign(p_session uuid, p_coach uuid, p_lock boolean DEFAULT false, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fail text;
  v_old uuid;
  r record;
begin
  if not is_founder() then raise exception 'founder_only'; end if;

  v_fail := coach_filter_failure(p_coach, p_session);
  if v_fail is not null and not p_force then
    raise exception 'filter_failed_%', v_fail;
  end if;

  select coach_id into v_old from class_sessions where id = p_session;

  update coach_assignments set status = 'superseded'
  where session_id = p_session and status = 'active';

  insert into coach_assignments (session_id, coach_id, assigned_by, locked, status)
  values (p_session, p_coach, auth.uid(), p_lock, 'active');

  update class_sessions set coach_id = p_coach where id = p_session;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'session.reassign', 'class_sessions', p_session,
          jsonb_build_object('from', v_old, 'to', p_coach, 'locked', p_lock,
                             'forced', p_force, 'overridden_rule', v_fail));

  -- notify old coach, new coach, booked clients — each collapsed per day
  if v_old is not null and v_old <> p_coach then
    perform queue_coach_changed(v_old, p_session, 'Session reassigned',
            'One of your sessions was moved to another coach.', '/coach/calendar');
  end if;

  perform queue_coach_changed(p_coach, p_session, 'New session assigned',
          'A session was added to your calendar.', '/coach/calendar');

  for r in
    select distinct b.client_id
    from bookings b
    where b.session_id = p_session and b.status = 'confirmed'
  loop
    perform queue_coach_changed(r.client_id, p_session, 'Meet your new coach',
            'Your session has a new coach — say hello at the table.', '/app/schedule');
  end loop;
end;
$function$;

-- ── handle_coach_dropout — cover cascade, same collapse ─────────────────────
CREATE OR REPLACE FUNCTION public.handle_coach_dropout(p_coach uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  c record;
  v_new uuid;
begin
  for r in
    select s.id
    from class_sessions s
    where s.coach_id = p_coach and s.status = 'scheduled'
      and s.starts_at >= p_from and s.starts_at < p_to
      and not exists (
        select 1 from coach_assignments a
        where a.session_id = s.id and a.status = 'active' and a.locked
      )
  loop
    -- exclude the dropping coach by temporarily deactivating is heavy; instead:
    update class_sessions set coach_id = null where id = r.id;
    update coach_assignments set status = 'superseded'
      where session_id = r.id and status = 'active';

    select rc.coach_id into v_new
    from rank_coaches(r.id) rc
    where rc.coach_id <> p_coach
    limit 1;

    if v_new is not null then
      insert into coach_assignments (session_id, coach_id, assigned_by, status)
      values (r.id, v_new, null, 'active');
      update class_sessions set coach_id = v_new where id = r.id;

      perform queue_coach_changed(v_new, r.id, 'You picked up a session',
              'Cover assigned to you automatically.', '/coach/calendar');

      for c in
        select distinct b.client_id
        from bookings b
        where b.session_id = r.id and b.status = 'confirmed'
      loop
        perform queue_coach_changed(c.client_id, r.id, 'Meet your new coach',
                'Your session has a new coach.', '/app/schedule');
      end loop;
    else
      insert into notifications (user_id, type, title, body, data)
      select p.id, 'session_unassigned', 'Cover needed',
             'A coach dropped a session and no substitute fits.',
             jsonb_build_object('session_id', r.id, 'url', '/admin/calendar')
      from profiles p where p.role = 'founder';
      -- clients are NOT notified — founder decides the outcome
    end if;

    insert into audit_log (actor_id, action, entity, entity_id, meta)
    values (auth.uid(), 'session.dropout_cascade', 'class_sessions', r.id,
            jsonb_build_object('dropped_coach', p_coach, 'replacement', v_new));
  end loop;
end;
$function$;
