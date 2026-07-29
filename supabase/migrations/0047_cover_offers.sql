-- notification-fix-plan Phase 3 item 3 (K8) — cover offers, first-tap-wins.
--
-- Today, when a session ends up with no coach, the founder is told
-- (`session_unassigned`) and then has to ring round. That is the single
-- largest category of founder interruption in the audit — escalations ran
-- 42–64 rows/day across the founder accounts — and every one of them ends in
-- the founder doing manual matchmaking that the system already has the data to
-- do itself: rank_coaches() knows exactly who is eligible.
--
-- So: offer the session to every eligible coach at once and let the first one
-- to tap take it. This mirrors the waitlist-claim model already in the product
-- (claim_waitlist_spot), including its concurrency handling — the row lock plus
-- the coach_id null check is what makes "first tap wins" true rather than
-- hopeful.
--
-- The founder still hears about it, but as an outcome ("X picked up the
-- Thursday class") rather than as a task.

-- ── Offer a session to every eligible coach ─────────────────────────────────
create or replace function public.offer_cover_session(p_session uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_when    text;
  v_where   text;
  v_count   int := 0;
  r record;
begin
  select * into v_session from class_sessions where id = p_session;
  if not found or v_session.status <> 'scheduled' then return 0; end if;
  if v_session.coach_id is not null then return 0; end if;
  if v_session.starts_at <= now() then return 0; end if;

  select * into v_class from classes where id = v_session.class_id;

  select coalesce(v.name, pcd.address, 'the venue')
    into v_where
    from classes c
    left join venues v on v.id = c.venue_id
    left join private_class_details pcd on pcd.class_id = c.id
   where c.id = v_session.class_id
   limit 1;

  v_when := fmt_ist(v_session.starts_at);

  -- rank_coaches applies the hard eligibility filters (availability, overlap,
  -- level, time off), so anyone it returns can actually take this session.
  for r in select rc.coach_id from rank_coaches(p_session) rc limit 10
  loop
    -- One offer per (coach, session), however many times the sweep runs.
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
      || ' needs a coach. First to claim it takes it — reply "claim" if you can cover.',
      jsonb_build_object('session_id', p_session,
                         'class_title', coalesce(v_class.title, 'a session'),
                         'time_str', v_when,
                         'location_str', v_where,
                         'url', '/coach/calendar'));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

comment on function public.offer_cover_session is
  'Offer an unassigned session to every eligible coach (K8). Idempotent per (coach, session).';

-- ── Claim it — first tap wins ───────────────────────────────────────────────
create or replace function public.claim_cover_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_coach uuid := auth.uid();
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_name    text;
  v_fail    text;
  r record;
begin
  if v_coach is null then raise exception 'not_authenticated'; end if;
  if not is_coach() then raise exception 'coach_only'; end if;

  -- The lock is the whole mechanism: two coaches tapping at once serialise
  -- here, and the second sees coach_id already set.
  select * into v_session from class_sessions where id = p_session for update;
  if not found or v_session.status <> 'scheduled' then raise exception 'session_not_available'; end if;
  if v_session.starts_at <= now() then raise exception 'session_started'; end if;
  if v_session.coach_id is not null then raise exception 'already_taken'; end if;

  v_fail := coach_filter_failure(v_coach, p_session);
  if v_fail is not null then raise exception 'filter_failed_%', v_fail; end if;

  update coach_assignments set status = 'superseded'
   where session_id = p_session and status = 'active';
  insert into coach_assignments (session_id, coach_id, assigned_by, status)
  values (p_session, v_coach, v_coach, 'active');

  update class_sessions set coach_id = v_coach where id = p_session;

  -- Claiming IS confirming — they've just told us they're coming, so don't turn
  -- round and nag them about it at T-60. This MUST be a second statement: the
  -- BEFORE UPDATE OF coach_id trigger (reset_session_confirmation) clears
  -- coach_confirmed_at whenever the coach changes, so stamping it in the same
  -- statement is silently undone.
  update class_sessions set coach_confirmed_at = now() where id = p_session;

  select * into v_class from classes where id = v_session.class_id;
  select full_name into v_name from profiles where id = v_coach;

  -- Retire the outstanding offers so a later tap gets a clean "already taken"
  -- and the worker stops re-sweeping them.
  update notifications set read_at = now()
   where type = 'cover_offer'
     and data->>'session_id' = p_session::text
     and read_at is null;

  -- The founder hears an outcome, not a task.
  insert into notifications (user_id, type, title, body, data)
  select p.id, 'ops_cover_claimed', 'Cover claimed',
         coalesce(v_name, 'A coach') || ' picked up ' || coalesce(v_class.title, 'a session')
         || ' (' || fmt_ist(v_session.starts_at) || ').',
         jsonb_build_object('session_id', p_session, 'coach_id', v_coach, 'url', '/admin/schedule')
    from profiles p where p.role = 'founder';

  -- Booked families are told, through the same per-day collapse as any other
  -- coach change.
  for r in
    select distinct b.client_id from bookings b
     where b.session_id = p_session and b.status = 'confirmed'
  loop
    perform queue_coach_changed(r.client_id, p_session, 'Meet your new coach',
            'Your session has a coach — say hello at the table.', '/app/schedule');
  end loop;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (v_coach, 'session.cover_claimed', 'class_sessions', p_session,
          jsonb_build_object('coach_id', v_coach));
end;
$function$;

comment on function public.claim_cover_session is
  'A coach claims an offered uncovered session. First tap wins (row lock + coach_id null check). See notification-fix-plan K8.';

grant execute on function public.offer_cover_session(uuid) to authenticated;
grant execute on function public.claim_cover_session(uuid) to authenticated;

-- ── Offer cover automatically when the cascade can't refill a session ───────
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
      --
      -- ...but before the founder has to ring anyone, offer it out (K8). This
      -- is a no-op when rank_coaches genuinely returns nobody, so the founder
      -- alert above stays the backstop rather than being replaced by it.
      perform offer_cover_session(r.id);
    end if;

    insert into audit_log (actor_id, action, entity, entity_id, meta)
    values (auth.uid(), 'session.dropout_cascade', 'class_sessions', r.id,
            jsonb_build_object('dropped_coach', p_coach, 'replacement', v_new));
  end loop;
end;
$function$;
