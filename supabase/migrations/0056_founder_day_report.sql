-- The founder's one delivered summary counted notification ROWS.
--
--   "12 bookings · 2 cancellations · 1 new client"
--
-- Two things were wrong with that. It counts rows and not events, so "2
-- membership changes" reads identically whether two families joined or two
-- quit. And it counts only FEED_ONLY types — which the two coach escalations
-- (`ops_coach_unconfirmed`, `ops_coach_not_arrived`) are NOT members of. So the
-- one number a founder actually wants at 21:00 was the one number structurally
-- excluded: on 29 Jul it reported "2 WhatsApp links" and omitted all 15
-- coach-reliability incidents that day.
--
-- This is the query behind the replacement: did the coaches turn up, on time,
-- and did they file the roster afterwards. Nothing here is new data — every
-- column has existed since the arrival-flow rework (migration 0039). It was
-- simply never read.
--
-- Lives in SQL rather than in the worker so it is testable under tests/db/
-- without a Deno runtime or a Twilio account, per AGENTS.md.

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
    coalesce(nullif(btrim(p.full_name), ''), 'Unassigned'),
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
  'excluded every coach escalation.';

-- Founders only. The digest sweep runs as service-role and bypasses this, but
-- the function is callable from the app and must not leak the roster elsewhere.
REVOKE ALL ON FUNCTION public.founder_day_report(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.founder_day_report(date) TO service_role;
