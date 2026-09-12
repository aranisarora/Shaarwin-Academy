-- 0009: replace the London placeholder venues/classes with the real
-- Bengaluru batch schedule. Retires the old seed venues/classes, adds the
-- five live venues and nine weekly batches, teaches the session generator
-- about multi-day recurrence (BYDAY=MO,FR), and fixes placeholder coach
-- geo/availability so morning batches are assignable.

-- ── 1. Academy timezone: classes default to Asia/Kolkata ────────────────────
alter table classes alter column timezone set default 'Asia/Kolkata';
update classes set timezone = 'Asia/Kolkata' where timezone = 'Europe/London';

-- ── 2. Retire placeholder venues/classes (seed UUIDs from P02) ──────────────
-- Cancel live bookings on their future sessions first, then the sessions,
-- then deactivate the series. Nothing is deleted; history stays intact.
update bookings b
set status = 'cancelled_by_academy',
    cancelled_at = now(),
    cancel_reason = 'Schedule replaced by Bengaluru batches'
from class_sessions s
where b.session_id = s.id
  and s.class_id in ('00000000-0000-4000-8000-0000000000f1',
                     '00000000-0000-4000-8000-0000000000f2',
                     '00000000-0000-4000-8000-0000000000f3',
                     '00000000-0000-4000-8000-0000000000f4')
  and s.status = 'scheduled'
  and s.starts_at > now()
  and b.status in ('confirmed', 'waitlisted');

update class_sessions
set status = 'cancelled', cancel_reason = 'Placeholder schedule replaced'
where class_id in ('00000000-0000-4000-8000-0000000000f1',
                   '00000000-0000-4000-8000-0000000000f2',
                   '00000000-0000-4000-8000-0000000000f3',
                   '00000000-0000-4000-8000-0000000000f4')
  and status = 'scheduled'
  and starts_at > now();

update classes
set active = false, ends_on = current_date
where id in ('00000000-0000-4000-8000-0000000000f1',
             '00000000-0000-4000-8000-0000000000f2',
             '00000000-0000-4000-8000-0000000000f3',
             '00000000-0000-4000-8000-0000000000f4');

update venues
set active = false
where id in ('00000000-0000-4000-8000-0000000000c1',
             '00000000-0000-4000-8000-0000000000c2',
             '00000000-0000-4000-8000-0000000000c3');

-- ── 3. Coach placeholder geo/availability ───────────────────────────────────
-- Seed coaches were placed at London coordinates; move anything obviously
-- outside India to the Bellandur hub so proximity scoring works.
update coaches set base_lat = 12.9310, base_lng = 77.6830 where base_lat > 40;

-- Morning batches start 08:00 — open availability windows from 07:30.
update coach_availability set start_time = time '07:30' where start_time > time '07:30';

-- ── 4. Venues ────────────────────────────────────────────────────────────────
insert into venues (id, name, address, postcode, lat, lng, photo_url) values
  ('00000000-0000-4000-8000-0000000001c1', 'Adarsh Palm Retreat Lakefront',
   'Adarsh Palm Retreat Lakefront, Outer Ring Rd, next to Intel, Devarabisanahalli, Bellandur, Bengaluru, Karnataka',
   '560103', 12.9352, 77.6902, '/images/venue-hall.jpg'),
  ('00000000-0000-4000-8000-0000000001c2', 'Adarsh Palm Retreat',
   'Adarsh Palm Retreat, Bellandur, Bengaluru, Karnataka',
   '560103', 12.9268, 77.6810, '/images/venue-hall.jpg'),
  ('00000000-0000-4000-8000-0000000001c3', 'La Palazzo',
   'KMB La Palazzo, Sarjapur Rd, Ambalipura, HSR Layout, Bengaluru, Karnataka',
   '560102', 12.9110, 77.6670, '/images/venue-hall.jpg'),
  ('00000000-0000-4000-8000-0000000001c4', 'Mantri Espana',
   'Mantri Espana, Kariyammana Agrahara, Bellandur, Bengaluru, Karnataka',
   '560103', 12.9385, 77.6946, '/images/venue-hall.jpg'),
  ('00000000-0000-4000-8000-0000000001c5', 'Prestige St. John''s Wood',
   'Prestige St. John''s Wood, Tavarekere Main Rd, S.G. Palya, Bengaluru, Karnataka',
   '560029', 12.9290, 77.6014, '/images/venue-hall.jpg')
on conflict (id) do update
set name = excluded.name, address = excluded.address, postcode = excluded.postcode,
    lat = excluded.lat, lng = excluded.lng, active = true;

-- ── 5. Batches ───────────────────────────────────────────────────────────────
-- One class per batch; multi-day recurrence handled by the generator below.
insert into classes (id, class_type, title, description, skill_level, capacity,
                     duration_minutes, venue_id, timezone, recurrence_rule,
                     starts_on, created_by) values
  -- Adarsh Palm Retreat Lakefront — Juniors, Mon & Fri 17:00–18:00
  ('00000000-0000-4000-8000-0000000001f1', 'group', 'Juniors — Lakefront',
   'Ages 6–14. Fundamentals, footwork and fast rallies by the lake.',
   'beginner', 12, 60, '00000000-0000-4000-8000-0000000001c1', 'Asia/Kolkata',
   'FREQ=WEEKLY;BYDAY=MO,FR', current_date,
   (select id from profiles where role = 'founder' order by created_at limit 1)),
  -- Adarsh Palm Retreat — Juniors, Tue & Thu 16:00–17:00
  ('00000000-0000-4000-8000-0000000001f2', 'group', 'Juniors — Palm Retreat',
   'Ages 6–14. Grip, stance and your first hundred rallies.',
   'beginner', 12, 60, '00000000-0000-4000-8000-0000000001c2', 'Asia/Kolkata',
   'FREQ=WEEKLY;BYDAY=TU,TH', current_date,
   (select id from profiles where role = 'founder' order by created_at limit 1)),
  -- Adarsh Palm Retreat — Intermediate, Tue & Thu 20:00–21:00
  ('00000000-0000-4000-8000-0000000001f3', 'group', 'Intermediate — Palm Retreat',
   'Serve variations, loop mechanics and third-ball patterns after work.',
   'intermediate', 10, 60, '00000000-0000-4000-8000-0000000001c2', 'Asia/Kolkata',
   'FREQ=WEEKLY;BYDAY=TU,TH', current_date,
   (select id from profiles where role = 'founder' order by created_at limit 1)),
  -- La Palazzo — Morning Adults, Tue & Thu 08:00–09:00
  ('00000000-0000-4000-8000-0000000001f4', 'group', 'Morning Adults — La Palazzo',
   'Start the day at the table — drills, rallies and match play before work.',
   'intermediate', 10, 60, '00000000-0000-4000-8000-0000000001c3', 'Asia/Kolkata',
   'FREQ=WEEKLY;BYDAY=TU,TH', current_date,
   (select id from profiles where role = 'founder' order by created_at limit 1)),
  -- La Palazzo — Juniors A, Mon & Tue 18:00–19:00
  ('00000000-0000-4000-8000-0000000001f5', 'group', 'Juniors A — La Palazzo',
   'Ages 6–14. Early-evening group — fundamentals and footwork.',
   'beginner', 12, 60, '00000000-0000-4000-8000-0000000001c3', 'Asia/Kolkata',
   'FREQ=WEEKLY;BYDAY=MO,TU', current_date,
   (select id from profiles where role = 'founder' order by created_at limit 1)),
  -- La Palazzo — Juniors B, Mon & Tue 19:00–20:00
  ('00000000-0000-4000-8000-0000000001f6', 'group', 'Juniors B — La Palazzo',
   'Ages 6–14. Later group — consistency, spin and match play.',
   'beginner', 12, 60, '00000000-0000-4000-8000-0000000001c3', 'Asia/Kolkata',
   'FREQ=WEEKLY;BYDAY=MO,TU', current_date,
   (select id from profiles where role = 'founder' order by created_at limit 1)),
  -- Mantri Espana — Juniors, Wed & Sat 16:30–17:30 (days TBC with venue)
  ('00000000-0000-4000-8000-0000000001f7', 'group', 'Juniors — Espana',
   'Ages 6–14. After-school fundamentals, midweek and weekend.',
   'beginner', 12, 60, '00000000-0000-4000-8000-0000000001c4', 'Asia/Kolkata',
   'FREQ=WEEKLY;BYDAY=WE,SA', current_date,
   (select id from profiles where role = 'founder' order by created_at limit 1)),
  -- Prestige St. John's Wood — Juniors A, Thu 18:00–19:00
  ('00000000-0000-4000-8000-0000000001f8', 'group', 'Juniors A — St. John''s Wood',
   'Ages 6–14. Thursday development group — technique and rallies.',
   'beginner', 12, 60, '00000000-0000-4000-8000-0000000001c5', 'Asia/Kolkata',
   'FREQ=WEEKLY;BYDAY=TH', current_date,
   (select id from profiles where role = 'founder' order by created_at limit 1)),
  -- Prestige St. John's Wood — Juniors B, Thu 19:15–20:15
  -- (was 18:15–19:15 overlapping batch A; staggered back-to-back so one
  --  coach can cover both on a single visit)
  ('00000000-0000-4000-8000-0000000001f9', 'group', 'Juniors B — St. John''s Wood',
   'Ages 6–14. Thursday second group — technique and match play.',
   'beginner', 12, 60, '00000000-0000-4000-8000-0000000001c5', 'Asia/Kolkata',
   'FREQ=WEEKLY;BYDAY=TH', current_date,
   (select id from profiles where role = 'founder' order by created_at limit 1))
on conflict (id) do update
set title = excluded.title, description = excluded.description,
    skill_level = excluded.skill_level, capacity = excluded.capacity,
    duration_minutes = excluded.duration_minutes, venue_id = excluded.venue_id,
    timezone = excluded.timezone, recurrence_rule = excluded.recurrence_rule,
    active = true;

-- ── 6. Session generator: multi-day BYDAY support ────────────────────────────
-- Prior version parsed exactly one BYDAY code; every Bengaluru batch runs on
-- one or more weekdays (BYDAY=MO,FR). Wall-clock time still comes from the
-- class's earliest session (anchor), defaulting to 18:30.
create or replace function public.generate_class_sessions(p_weeks int default 8)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  d date;
  v_days text[];
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
    v_days := string_to_array(substring(r.recurrence_rule from 'BYDAY=([A-Z,]+)'), ',');
    v_time := coalesce((r.first_start at time zone 'Asia/Kolkata')::time, time '18:30');
    for d in select generate_series(current_date, current_date + p_weeks * 7, interval '1 day')::date loop
      exit when r.ends_on is not null and d > r.ends_on;
      if (array['MO','TU','WE','TH','FR','SA','SU'])[extract(isodow from d)::int] = any (v_days) then
        v_start := (d::text || ' ' || v_time::text)::timestamp at time zone 'Asia/Kolkata';
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

-- ── 6b. rank_coaches: fix round() on double precision ───────────────────────
-- Latent bug since 0004: the score expression mixes numeric weights with
-- float8 normalised metrics, and round(double precision, int) does not
-- exist. It never fired because seeded sessions always had coaches
-- pre-assigned; the generation below is the first caller of the engine.
-- Body is the 0007 version with the round() argument cast to numeric.
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
          and date_trunc('week', s.starts_at at time zone 'Asia/Kolkata')
            = date_trunc('week', v_session.starts_at at time zone 'Asia/Kolkata')
      ), 0) as load_hours,
      (exists (
        select 1 from class_sessions s
        join classes c2 on c2.id = s.class_id
        left join venues v2 on v2.id = c2.venue_id
        where s.coach_id = c.id and s.status = 'scheduled' and s.id <> p_session
          and (s.starts_at at time zone 'Asia/Kolkata')::date
            = (v_session.starts_at at time zone 'Asia/Kolkata')::date
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
    round((
      (v_weights->>'continuity')::numeric * n.continuity
      + (v_weights->>'proximity')::numeric * n.proximity_n
      + (v_weights->>'load')::numeric * n.load_n
      + (v_weights->>'adjacency')::numeric * n.adjacency
      + (v_weights->>'seniority')::numeric * n.seniority_n
      + case when p_preferred is not null and n.id = p_preferred then 40 else 0 end
    )::numeric, 2) as score
  from norm n
  order by score desc, n.load_hours asc, n.tier desc, n.id asc;
end;
$$;

-- ── 7. Anchor sessions (set each batch's wall-clock time), then generate ────
-- The generator reads each class's time from its earliest session, so insert
-- the first upcoming occurrence at the correct time for every new batch.
do $$
declare
  rec record;
  v_days text[];
  d date;
  v_start timestamptz;
begin
  for rec in
    select t.class_id, t.start_time, c.recurrence_rule, c.duration_minutes
    from (values
      ('00000000-0000-4000-8000-0000000001f1'::uuid, time '17:00'),
      ('00000000-0000-4000-8000-0000000001f2', time '16:00'),
      ('00000000-0000-4000-8000-0000000001f3', time '20:00'),
      ('00000000-0000-4000-8000-0000000001f4', time '08:00'),
      ('00000000-0000-4000-8000-0000000001f5', time '18:00'),
      ('00000000-0000-4000-8000-0000000001f6', time '19:00'),
      ('00000000-0000-4000-8000-0000000001f7', time '16:30'),
      ('00000000-0000-4000-8000-0000000001f8', time '18:00'),
      ('00000000-0000-4000-8000-0000000001f9', time '19:15')
    ) as t(class_id, start_time)
    join classes c on c.id = t.class_id
  loop
    v_days := string_to_array(substring(rec.recurrence_rule from 'BYDAY=([A-Z,]+)'), ',');
    for d in select generate_series(current_date, current_date + 7, interval '1 day')::date loop
      if (array['MO','TU','WE','TH','FR','SA','SU'])[extract(isodow from d)::int] = any (v_days) then
        v_start := (d::text || ' ' || rec.start_time::text)::timestamp at time zone 'Asia/Kolkata';
        if v_start > now() then
          insert into class_sessions (class_id, starts_at, ends_at)
          select rec.class_id, v_start, v_start + make_interval(mins => rec.duration_minutes)
          where not exists (
            select 1 from class_sessions s
            where s.class_id = rec.class_id and s.starts_at = v_start
          );
          exit;  -- anchor placed for this class
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- Fill the next 4 weeks and auto-assign coaches.
select public.generate_class_sessions(4);
