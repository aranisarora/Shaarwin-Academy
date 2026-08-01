-- 0056 coalesced a NULL coach to the literal name 'Unassigned'. The 21:00
-- digest then treats every row with no arrival mark as a coach who failed to
-- mark one, so a session nobody was ever rostered onto is reported as:
--
--   "Unassigned never marked arrival (Windmills Private, 9:00 am)"
--
-- (Live in the 2026-08-01 digest.) That reads as a coach-compliance failure and
-- is nothing of the kind — it is a scheduling gap, it needs a different action
-- from the founder, and it inflates the count of coaches who ignored the
-- arrival prompt. It also spends one of the three named slots in the digest's
-- attention line on a non-coach.
--
-- The two facts are now distinguishable: `coach_name` is NULL exactly when
-- `coach_id` is, and the caller decides how to say it. The label was only ever
-- presentation, and presentation belongs in the caller (summariseDay), not in
-- the fact source.
--
-- No other caller reads coach_name — founder_day_report has one, the digest
-- sweep in supabase/functions/notify.

CREATE OR REPLACE FUNCTION public.founder_day_report(p_date date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date)
 RETURNS TABLE(
   session_id     uuid,
   class_title    text,
   coach_id       uuid,
   coach_name     text,
   starts_at      timestamptz,
   time_str       text,
   confirmed_at   timestamptz,
   arrived_at     timestamptz,
   minutes_late   integer,
   arrival_source text,
   distance_m     integer,
   roster_size    integer,
   roster_marked  integer
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.id,
    c.title,
    s.coach_id,
    -- NULL for an unassigned session. Was coalesce(..., 'Unassigned'), which
    -- made a scheduling gap indistinguishable from a coach who ignored the
    -- prompt. A rostered coach with a blank profile name still resolves to
    -- 'Coach' so the digest never renders an empty string.
    case when s.coach_id is null
         then null
         else coalesce(nullif(btrim(p.full_name), ''), 'Coach')
    end,
    s.starts_at,
    to_char(s.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
    s.coach_confirmed_at,
    s.coach_arrived_at,
    -- NULL when they never marked arrival at all: "late" and "absent" are
    -- different facts and the caller must be able to tell them apart. Negative
    -- (early) is clamped to 0 — nobody wants a report of who was 4 minutes keen.
    case
      when s.coach_arrived_at is null then null
      else greatest(0, (extract(epoch from s.coach_arrived_at - s.starts_at) / 60)::int)
    end,
    s.coach_arrival_source,
    s.coach_arrival_distance_m,
    (select count(*)::int from bookings b
      where b.session_id = s.id
        and b.status in ('confirmed', 'attended', 'no_show')),
    -- Attendance is bookings.status, so "marked" means moved off 'confirmed'.
    -- sweep_session_status auto-attends anything still confirmed 48h after the
    -- session, which is why this is read on the evening of the day and not later.
    (select count(*)::int from bookings b
      where b.session_id = s.id
        and b.status in ('attended', 'no_show'))
  from class_sessions s
  join classes c on c.id = s.class_id
  left join profiles p on p.id = s.coach_id
  where s.status <> 'cancelled'
    and (s.starts_at at time zone 'Asia/Kolkata')::date = p_date
  order by s.starts_at;
$function$;

COMMENT ON FUNCTION public.founder_day_report IS
  'Per-session punctuality and roster-completion facts for one IST day. Backs '
  'the 21:00 founder summary (sweepFounderDigest). Replaces a row count that '
  'excluded every coach escalation. coach_name is NULL for an unassigned '
  'session so the caller can separate a scheduling gap from a coach no-show.';

REVOKE ALL ON FUNCTION public.founder_day_report(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.founder_day_report(date) TO service_role;
