CREATE OR REPLACE FUNCTION public.get_bookable_slots(p_lat double precision, p_lng double precision, p_duration integer, p_player uuid, p_days integer DEFAULT 14)
 RETURNS TABLE(starts_at timestamp with time zone, coach_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_buf interval := make_interval(mins => get_setting_int('travel_buffer_minutes', 30));
  v_from timestamptz := date_trunc('hour', now() + interval '24 hours');
  v_to timestamptz := now() + make_interval(days => p_days);
begin
  return query
  with candidate_coaches as (
    select c.* from coaches c
    where c.active
  ),
  slots as (
    select generate_series(v_from, v_to, interval '30 minutes') as slot_start
  )
  select s.slot_start, count(c.id)::int
  from slots s
  cross join candidate_coaches c
  where
    not exists (
      select 1 from class_sessions cs
      where cs.coach_id = c.id and cs.status = 'scheduled'
        and cs.starts_at < v_to + make_interval(mins => p_duration) + v_buf
        and cs.ends_at > v_from - v_buf
        and tstzrange(cs.starts_at - v_buf, cs.ends_at + v_buf)
          && tstzrange(s.slot_start, s.slot_start + make_interval(mins => p_duration))
    )
  group by s.slot_start
  order by s.slot_start;
end;
$function$;
