-- 0006 — RLS recursion fix · P10 private reschedule · P12 scheduled ops.
-- RUN THIS in the Supabase SQL editor (the 0001 policies recurse:
-- classes ↔ class_sessions ↔ private_class_details → "42P17 infinite recursion").

-- ── Security-definer helpers break the policy cycles ────────────────────────
-- (definer functions bypass RLS on the tables they query)

create or replace function public.class_is_public_group(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from classes c
    where c.id = p_class and c.active and c.class_type = 'group'
  );
$$;

create or replace function public.coach_teaches_class(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from class_sessions s
    where s.class_id = p_class and s.coach_id = auth.uid()
  );
$$;

create or replace function public.client_owns_private_class(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from private_class_details d
    where d.class_id = p_class and d.client_id = auth.uid()
  );
$$;

create or replace function public.coach_has_client(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b
    join class_sessions s on s.id = b.session_id
    where b.client_id = p_client and s.coach_id = auth.uid()
  );
$$;

create or replace function public.coach_has_player(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b
    join class_sessions s on s.id = b.session_id
    where b.player_id = p_player and s.coach_id = auth.uid()
  );
$$;

-- ── Recreate the cyclic policies on top of the helpers ──────────────────────

drop policy if exists "public reads active group classes" on classes;
create policy "public reads active group classes" on classes
  for select using (
    (active = true and class_type = 'group')
    or is_founder()
    or (is_coach() and coach_teaches_class(id))
    or client_owns_private_class(id)
  );

drop policy if exists "read scheduled sessions" on class_sessions;
create policy "read scheduled sessions" on class_sessions
  for select using (
    class_is_public_group(class_id)
    or coach_id = auth.uid()
    or is_founder()
    or client_owns_private_class(class_id)
  );

drop policy if exists "private details visible to owner coach founder" on private_class_details;
create policy "private details visible to owner coach founder" on private_class_details
  for select using (
    client_id = auth.uid()
    or is_founder()
    or coach_teaches_class(class_id)
  );

drop policy if exists "coach reads clients in own sessions" on profiles;
create policy "coach reads clients in own sessions" on profiles
  for select using (is_coach() and coach_has_client(id));

drop policy if exists "coach reads own rosters players" on players;
create policy "coach reads own rosters players" on players
  for select using (is_coach() and coach_has_player(id));

-- ── P10 — reschedule_private_session ────────────────────────────────────────
-- p_confirm=false → returns the proposed coach, changes nothing (preview).
create or replace function public.reschedule_private_session(
  p_session uuid, p_new_start timestamptz, p_confirm bool default false
) returns table (proposed_coach uuid, coach_changed boolean)
language plpgsql security definer set search_path = public as $$
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
      select 1 from coach_time_off t
      where t.coach_id = v_old_coach and t.status = 'approved'
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_new_start, v_new_end)
    ) then v_fail := 'time_off'; end if;
    if v_fail is null and not exists (
      select 1 from coach_availability a
      where a.coach_id = v_old_coach
        and a.weekday = ((extract(isodow from p_new_start at time zone 'Europe/London'))::int - 1)
        and a.start_time <= (p_new_start at time zone 'Europe/London')::time
        and a.end_time >= (v_new_end at time zone 'Europe/London')::time
    ) then v_fail := 'unavailable'; end if;
    if v_fail is null and exists (
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
     to_char(p_new_start at time zone 'Europe/London', 'Dy DD Mon HH24:MI'),
     jsonb_build_object('session_id', p_session, 'url', '/app/schedule'));
  if v_old_coach is not null and v_old_coach <> v_new_coach then
    insert into notifications (user_id, type, title, body, data) values
      (v_old_coach, 'coach_changed', 'Session moved',
       'A private session was rescheduled away from you.',
       jsonb_build_object('session_id', p_session, 'url', '/coach/calendar'));
  end if;
  insert into notifications (user_id, type, title, body, data) values
    (v_new_coach, 'new_private_session', 'Private session (rescheduled)',
     to_char(p_new_start at time zone 'Europe/London', 'Dy DD Mon HH24:MI'),
     jsonb_build_object('session_id', p_session, 'url', '/coach/session/' || p_session));

  return query select v_new_coach, (v_new_coach is distinct from v_old_coach);
end;
$$;

-- ── P09/P12 — session generation + engine sweep ─────────────────────────────
create or replace function public.assign_unassigned_sessions()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select id from class_sessions
    where coach_id is null and status = 'scheduled' and starts_at > now()
  loop
    if assign_coach(r.id) is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.generate_class_sessions(p_weeks int default 8)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  d date;
  v_wd int;
  v_start timestamptz;
  v_count int := 0;
  v_time time;
begin
  for r in
    select c.*, (select s.starts_at from class_sessions s where s.class_id = c.id
                 order by s.starts_at limit 1) as first_start
    from classes c where c.class_type = 'group' and c.active
      and c.recurrence_rule like 'FREQ=WEEKLY%'
  loop
    v_wd := case substring(r.recurrence_rule from 'BYDAY=(..)')
      when 'MO' then 1 when 'TU' then 2 when 'WE' then 3 when 'TH' then 4
      when 'FR' then 5 when 'SA' then 6 else 7 end;
    v_time := coalesce((r.first_start at time zone 'Europe/London')::time, time '18:30');
    for d in select generate_series(current_date, current_date + p_weeks * 7, interval '1 day')::date loop
      exit when r.ends_on is not null and d > r.ends_on;
      if extract(isodow from d) = v_wd then
        v_start := (d::text || ' ' || v_time::text)::timestamp at time zone 'Europe/London';
        if v_start > now() and not exists (
          select 1 from class_sessions s where s.class_id = r.id and s.starts_at = v_start
        ) then
          insert into class_sessions (class_id, starts_at, ends_at)
          values (r.id, v_start, v_start + make_interval(mins => r.duration_minutes));
          v_count := v_count + 1;
        end if;
      end if;
    end loop;
  end loop;
  perform assign_unassigned_sessions();
  return v_count;
end;
$$;

-- ── P12 — remaining sweeps ──────────────────────────────────────────────────
create or replace function public.sweep_session_status()
returns void language sql security definer set search_path = public as $$
  update class_sessions set status = 'completed'
  where status = 'scheduled' and ends_at < now();
  -- un-marked attendance defaults to attended after 48h
  update bookings b set status = 'attended'
  from class_sessions s
  where b.session_id = s.id and b.status = 'confirmed'
    and s.ends_at < now() - interval '48 hours';
$$;

create or replace function public.expire_credits()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_balance int;
begin
  for r in
    select s.client_id from subscriptions s
    where s.current_period_end < now() and s.status in ('canceled', 'past_due')
  loop
    v_balance := private_minutes_balance(r.client_id);
    if v_balance > 0 then
      insert into private_credit_ledger (client_id, delta_minutes, reason, note)
      values (r.client_id, -v_balance, 'expiry', 'period end sweep');
    end if;
  end loop;
end;
$$;

-- Schedule with pg_cron (Supabase: Database → Extensions → enable pg_cron first):
--   select cron.schedule('sessions-nightly', '0 3 * * *', $$select generate_class_sessions(8)$$);
--   select cron.schedule('status-hourly', '30 * * * *', $$select sweep_session_status()$$);
--   select cron.schedule('credits-nightly', '15 3 * * *', $$select expire_credits()$$);
