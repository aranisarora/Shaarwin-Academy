-- P06 — coach assignment engine. Pure Postgres, no UI.

create or replace function public.haversine_km(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable as $$
  select 2 * 6371 * asin(sqrt(
    sin(radians((lat2 - lat1) / 2)) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians((lng2 - lng1) / 2)) ^ 2
  ));
$$;

-- Hard filters as a reusable predicate. Returns why a coach fails (null = passes).
create or replace function public.coach_filter_failure(
  p_coach uuid, p_session uuid
) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_coach coaches%rowtype;
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_lat float8; v_lng float8;
  v_buffer int := get_setting_int('travel_buffer_minutes', 30);
  v_wd smallint;
  v_start time; v_end time;
  v_has_junior boolean;
begin
  select * into v_coach from coaches where id = p_coach and active;
  if not found then return 'inactive'; end if;

  select * into v_session from class_sessions where id = p_session;
  select * into v_class from classes where id = v_session.class_id;

  -- 1. time off
  if exists (
    select 1 from coach_time_off t
    where t.coach_id = p_coach and t.status = 'approved'
      and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then return 'time_off'; end if;

  -- 2. availability window (Europe/London wall clock, weekday 0=Mon)
  v_wd := ((extract(isodow from v_session.starts_at at time zone 'Europe/London'))::int - 1);
  v_start := (v_session.starts_at at time zone 'Europe/London')::time;
  v_end := (v_session.ends_at at time zone 'Europe/London')::time;
  if not exists (
    select 1 from coach_availability a
    where a.coach_id = p_coach and a.weekday = v_wd
      and a.start_time <= v_start and a.end_time >= v_end
  ) then return 'unavailable'; end if;

  -- 3. overlap incl. travel buffer at different locations
  if exists (
    select 1 from class_sessions s2
    join classes c2 on c2.id = s2.class_id
    where s2.coach_id = p_coach and s2.status = 'scheduled' and s2.id <> p_session
      and tstzrange(
            s2.starts_at - case when c2.venue_id is distinct from v_class.venue_id
                                then make_interval(mins => v_buffer) else interval '0' end,
            s2.ends_at + case when c2.venue_id is distinct from v_class.venue_id
                              then make_interval(mins => v_buffer) else interval '0' end
          ) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then return 'overlap'; end if;

  -- 4. radius for private sessions
  if v_class.class_type = 'private' then
    select d.lat, d.lng into v_lat, v_lng
    from private_class_details d where d.class_id = v_class.id;
    if haversine_km(v_lat, v_lng, v_coach.base_lat, v_coach.base_lng) > v_coach.travel_radius_km then
      return 'out_of_radius';
    end if;
  end if;

  -- 5. level ceiling
  if v_class.skill_level > v_coach.max_teachable_level then
    return 'level_too_high';
  end if;

  -- 6. safeguarding: junior in the room requires DBS
  select exists (
    select 1 from bookings b
    join players pl on pl.id = b.player_id
    where b.session_id = p_session
      and b.status in ('confirmed', 'waitlisted')
      and pl.date_of_birth is not null
      and pl.date_of_birth > (current_date - interval '18 years')
    union
    select 1 from private_class_details d
    join players pl on pl.id = d.player_id
    where d.class_id = v_class.id
      and pl.date_of_birth is not null
      and pl.date_of_birth > (current_date - interval '18 years')
  ) into v_has_junior;
  if v_has_junior and not v_coach.dbs_checked then
    return 'dbs_required';
  end if;

  return null;
end;
$$;

-- Ranked candidates with scores (also powers admin "ranked alternatives").
create or replace function public.rank_coaches(p_session uuid, p_preferred uuid default null)
returns table (coach_id uuid, score numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_weights jsonb;
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_lat float8; v_lng float8;
begin
  select coalesce(
    (select value from settings where key = 'assignment_weights'),
    '{"continuity":35,"proximity":25,"load":20,"adjacency":15,"seniority":5}'::jsonb
  ) into v_weights;

  select * into v_session from class_sessions where id = p_session;
  select * into v_class from classes where id = v_session.class_id;

  if v_class.class_type = 'private' then
    select d.lat, d.lng into v_lat, v_lng from private_class_details d where d.class_id = v_class.id;
  else
    select v.lat, v.lng into v_lat, v_lng from venues v where v.id = v_class.venue_id;
  end if;

  return query
  with pool as (
    select c.* from coaches c
    where c.active and coach_filter_failure(c.id, p_session) is null
  ),
  metrics as (
    select
      c.id,
      -- continuity: coached this class (group) or this client (private) before
      (case when v_class.class_type = 'group' then exists (
          select 1 from class_sessions s where s.class_id = v_class.id
            and s.coach_id = c.id and s.id <> p_session)
        else exists (
          select 1 from class_sessions s
          join classes c2 on c2.id = s.class_id
          join private_class_details d on d.class_id = c2.id
          where s.coach_id = c.id
            and d.client_id = (select client_id from private_class_details where class_id = v_class.id))
      end)::int as continuity,
      haversine_km(v_lat, v_lng, c.base_lat, c.base_lng) as dist,
      coalesce((
        select sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600.0)
        from class_sessions s
        where s.coach_id = c.id and s.status = 'scheduled'
          and date_trunc('week', s.starts_at at time zone 'Europe/London')
            = date_trunc('week', v_session.starts_at at time zone 'Europe/London')
      ), 0) as load_hours,
      (exists (
        select 1 from class_sessions s
        join classes c2 on c2.id = s.class_id
        left join venues v2 on v2.id = c2.venue_id
        where s.coach_id = c.id and s.status = 'scheduled' and s.id <> p_session
          and (s.starts_at at time zone 'Europe/London')::date
            = (v_session.starts_at at time zone 'Europe/London')::date
          and abs(extract(epoch from (s.starts_at - v_session.ends_at))) <= 7200
          and (c2.venue_id is not distinct from v_class.venue_id
               or (v2.lat is not null and haversine_km(v_lat, v_lng, v2.lat, v2.lng) <= 3))
      ))::int as adjacency,
      c.tier
    from pool c
  ),
  norm as (
    select *,
      case when max(dist) over () = min(dist) over () then 1.0
           else 1.0 - (dist - min(dist) over ()) / nullif(max(dist) over () - min(dist) over (), 0) end as proximity_n,
      case when max(load_hours) over () = min(load_hours) over () then 1.0
           else 1.0 - (load_hours - min(load_hours) over ()) / nullif(max(load_hours) over () - min(load_hours) over (), 0) end as load_n,
      case when max(tier) over () = min(tier) over () then 1.0
           else (tier - min(tier) over ())::numeric / nullif(max(tier) over () - min(tier) over (), 0) end as seniority_n
    from metrics
  )
  select
    n.id,
    round(
      (v_weights->>'continuity')::numeric * n.continuity
      + (v_weights->>'proximity')::numeric * n.proximity_n
      + (v_weights->>'load')::numeric * n.load_n
      + (v_weights->>'adjacency')::numeric * n.adjacency
      + (v_weights->>'seniority')::numeric * n.seniority_n
      + case when p_preferred is not null and n.id = p_preferred then 40 else 0 end
    , 2) as score
  from norm n
  order by score desc, n.load_hours asc, n.tier desc, n.id asc;
end;
$$;

create or replace function public.assign_coach(p_session uuid, p_preferred uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_winner uuid;
  v_score numeric;
begin
  -- Never touch a locked assignment (E3)
  if exists (
    select 1 from coach_assignments
    where session_id = p_session and status = 'active' and locked
  ) then
    select coach_id into v_winner from coach_assignments
    where session_id = p_session and status = 'active' and locked;
    return v_winner;
  end if;

  select coach_id, score into v_winner, v_score
  from rank_coaches(p_session, p_preferred) limit 1;

  if v_winner is null then
    update class_sessions set coach_id = null where id = p_session;
    insert into notifications (user_id, type, title, body, data)
    select p.id, 'session_unassigned', 'Session needs a coach',
           'No coach fits this slot — resolve it in the calendar.',
           jsonb_build_object('session_id', p_session, 'url', '/admin/calendar')
    from profiles p where p.role = 'founder';
    return null;
  end if;

  update coach_assignments set status = 'superseded'
  where session_id = p_session and status = 'active';

  insert into coach_assignments (session_id, coach_id, assigned_by, score, status)
  values (p_session, v_winner, null, v_score, 'active');

  update class_sessions set coach_id = v_winner where id = p_session;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (null, 'session.assign', 'class_sessions', p_session,
          jsonb_build_object('coach_id', v_winner, 'score', v_score));

  return v_winner;
end;
$$;

create or replace function public.founder_reassign(p_session uuid, p_coach uuid, p_lock bool default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fail text;
  v_old uuid;
begin
  if not is_founder() then raise exception 'founder_only'; end if;

  v_fail := coach_filter_failure(p_coach, p_session);
  if v_fail is not null then
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
          jsonb_build_object('from', v_old, 'to', p_coach, 'locked', p_lock));

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
$$;

create or replace function public.get_bookable_slots(
  p_lat float8, p_lng float8, p_duration int, p_player uuid, p_days int default 14
) returns table (starts_at timestamptz, coach_count int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_is_junior boolean;
begin
  select pl.date_of_birth is not null
     and pl.date_of_birth > (current_date - interval '18 years')
  into v_is_junior
  from players pl where pl.id = p_player;

  return query
  with candidate_coaches as (
    select c.* from coaches c
    where c.active
      and haversine_km(p_lat, p_lng, c.base_lat, c.base_lng) <= c.travel_radius_km
      and (not coalesce(v_is_junior, false) or c.dbs_checked)
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
    -- availability window
    exists (
      select 1 from coach_availability a
      where a.coach_id = c.id
        and a.weekday = ((extract(isodow from s.slot_start at time zone 'Europe/London'))::int - 1)
        and a.start_time <= (s.slot_start at time zone 'Europe/London')::time
        and a.end_time >= ((s.slot_start + make_interval(mins => p_duration)) at time zone 'Europe/London')::time
    )
    -- no approved time off
    and not exists (
      select 1 from coach_time_off t
      where t.coach_id = c.id and t.status = 'approved'
        and tstzrange(t.starts_at, t.ends_at)
          && tstzrange(s.slot_start, s.slot_start + make_interval(mins => p_duration))
    )
    -- no overlapping scheduled session (+ buffer, conservatively applied)
    and not exists (
      select 1 from class_sessions cs
      where cs.coach_id = c.id and cs.status = 'scheduled'
        and tstzrange(cs.starts_at - make_interval(mins => get_setting_int('travel_buffer_minutes', 30)),
                      cs.ends_at + make_interval(mins => get_setting_int('travel_buffer_minutes', 30)))
          && tstzrange(s.slot_start, s.slot_start + make_interval(mins => p_duration))
    )
  group by s.slot_start
  order by s.slot_start;
end;
$$;

create or replace function public.handle_coach_dropout(p_coach uuid, p_from timestamptz, p_to timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
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

      insert into notifications (user_id, type, title, body, data)
      values (v_new, 'coach_changed', 'You picked up a session',
              'Cover assigned to you automatically.',
              jsonb_build_object('session_id', r.id, 'url', '/coach/calendar'));

      insert into notifications (user_id, type, title, body, data)
      select distinct b.client_id, 'coach_changed', 'Meet your new coach',
             'Your session has a new coach.',
             jsonb_build_object('session_id', r.id, 'url', '/app/schedule')
      from bookings b where b.session_id = r.id and b.status = 'confirmed';
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
$$;
