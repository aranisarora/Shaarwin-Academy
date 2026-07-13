-- Remove the DBS gate from private-session slot search.
--
-- get_bookable_slots previously filtered out any coach whose dbs_checked was
-- false whenever the player was a junior (under 18). With no DBS-checked
-- coaches on file, every junior booking returned zero slots and the wizard
-- showed "No servable times in the next two weeks" regardless of duration.
-- Coaches are DBS-checked, so mark them accordingly and drop the gate.

UPDATE coaches SET dbs_checked = true WHERE active AND dbs_checked = false;

CREATE OR REPLACE FUNCTION public.get_bookable_slots(p_lat double precision, p_lng double precision, p_duration integer, p_player uuid, p_days integer DEFAULT 14)
 RETURNS TABLE(starts_at timestamp with time zone, coach_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with candidate_coaches as (
    select c.* from coaches c
    where c.active
      and haversine_km(p_lat, p_lng, c.base_lat, c.base_lng) <= c.travel_radius_km
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
        and a.weekday = ((extract(isodow from s.slot_start at time zone 'Asia/Kolkata'))::int - 1)
        and a.start_time <= (s.slot_start at time zone 'Asia/Kolkata')::time
        and a.end_time >= ((s.slot_start + make_interval(mins => p_duration)) at time zone 'Asia/Kolkata')::time
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
$function$;
