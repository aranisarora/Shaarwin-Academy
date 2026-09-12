-- Coaches' default availability was seeded from 16:00; widen to 10:00 so
-- private-class booking slots are available from morning onwards.

-- Backfill existing rows that still have the old 16:00 default start time.
update coach_availability
set start_time = '10:00'
where start_time = '16:00';

-- Fix the trigger function so new coaches are seeded 10:00–22:00.
create or replace function public.seed_default_coach_availability()
  returns trigger
  language plpgsql
  security definer
  set search_path = 'public'
as $$
begin
  insert into coach_availability (coach_id, weekday, start_time, end_time)
  select new.id, d, '10:00', '22:00'
  from generate_series(0, 6) as d
  where not exists (
    select 1 from coach_availability where coach_id = new.id
  );
  return new;
end;
$$;
