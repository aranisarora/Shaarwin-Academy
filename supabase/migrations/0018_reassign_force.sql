-- Founder override for coach reassignment: p_force skips the hard-filter check
-- (time off, availability window, travel buffer). A genuine double-booking is
-- still blocked by the coach_no_overlap exclusion constraint.

drop function if exists public.founder_reassign(uuid, uuid, boolean);

create or replace function public.founder_reassign(
  p_session uuid,
  p_coach uuid,
  p_lock boolean default false,
  p_force boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fail text;
  v_old uuid;
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

  -- notify old coach, new coach, booked clients
  if v_old is not null and v_old <> p_coach then
    insert into notifications (user_id, type, title, body, data)
    values (v_old, 'coach_changed', 'Session reassigned',
            'One of your sessions was moved to another coach.',
            jsonb_build_object('session_id', p_session, 'url', '/coach/calendar'));
  end if;

  insert into notifications (user_id, type, title, body, data)
  values (p_coach, 'coach_changed', 'New session assigned',
          'A session was added to your calendar.',
          jsonb_build_object('session_id', p_session, 'url', '/coach/calendar'));

  insert into notifications (user_id, type, title, body, data)
  select distinct b.client_id, 'coach_changed', 'Meet your new coach',
         'Your session has a new coach — say hello at the table.',
         jsonb_build_object('session_id', p_session, 'url', '/app/schedule')
  from bookings b
  where b.session_id = p_session and b.status = 'confirmed';
end;
$function$;
