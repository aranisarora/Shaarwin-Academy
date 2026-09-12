-- A class that has finished should stop saying it hasn't.
--
-- `sweep_session_status()` has existed since 0006 and has never once run.
-- Migration 0006 wrote the three cron lines it expected into a comment and
-- nobody ever executed them, so `cron.job` holds two rows — the notify worker
-- and the nightly private-series roll — and this is not one of them. The result
-- is that a session's status only ever leaves 'scheduled' when a coach taps a
-- register. When nobody taps, nothing settles, ever: on the day this was written
-- production held 325 sessions still marked 'scheduled' whose hour had passed,
-- carrying 57 bookings still marked 'confirmed'. Every screen reads those
-- sessions as still to come, and a class the founder wants gone is pinned to the
-- list by a place somebody is supposedly still holding in it. That is the rot,
-- and this is the schedule that stops it at source.
--
-- ── What was deliberately dropped, and what would bring it back ──────────────
--
-- The 0006 function had a second statement. After 48 hours it defaulted every
-- un-marked 'confirmed' booking to 'attended'. Scheduling the function as
-- written would have run that statement too, and it is not a bookkeeping
-- tidy-up — it invents a register. Switched on today it would mark 44 bookings
-- attended on the strength of nobody having said otherwise.
--
-- 'attended' is not an internal flag. It is the number a parent reads on their
-- child's attendance, what a school sees of its own pupils, the answer the
-- WhatsApp bot gives to "did my child go to class?", and the headcount the
-- founder plans from (lib/student-insights.ts, lib/school.ts,
-- lib/whatsapp/tools/client.ts, the admin player counts). Every one of those
-- would be reporting a fact the academy made up because a coach was busy. A
-- missing register is an honest gap and looks like one; a fabricated register is
-- indistinguishable from a real one, and there is no later moment at which
-- anybody could tell them apart again.
--
-- So the sweep now closes sessions and does nothing else. The tradeoff was put
-- to the owner in exactly those terms and this is the half he chose.
--
-- Bringing the other half back needs something this schema does not have: a way
-- to tell "the coach marked everyone present and the UI recorded it as silence"
-- apart from "nobody ever opened the register". A per-session
-- `roster_marked_at`, or an explicit "all present" tap that writes every row,
-- would give the sweep a fact to act on rather than an absence to guess from.
-- Until one of those exists, an unmarked booking stays 'confirmed' and the
-- screens that read it say so — `lib/admin-ops-classes.ts` already counts a held
-- place on a session behind us separately for this reason.
--
-- ── Cadence ─────────────────────────────────────────────────────────────────
--
-- Hourly, at five past. Nothing reads this flag on a deadline: it is bookkeeping
-- that has to be true by the time somebody looks at a screen, and the shortest
-- interval that matters is a founder opening /admin. Every minute would run a
-- full update 1,440 times a day to usually change nothing, and that slot already
-- belongs to the notify worker. Nightly would leave a class that finished at
-- 09:00 advertising itself as upcoming — and refusing to be ended — for the
-- whole working day, which is the exact failure being fixed.
--
-- Five past rather than on the hour, because classes end on the hour and the
-- half hour. Landing the sweep on that same boundary makes "has it ended" a
-- question about clock skew, and the few minutes of margin also leave the coach's
-- own register tap and the arrival ladder the room they need.
--
-- Safe against the worker's sweeps by construction: this only touches sessions
-- whose `ends_at` is already past, every coach prompt targets a session that is
-- still ahead of us or has just started, and `sweepAfterClass` — the one that
-- looks backwards — accepts 'scheduled' and 'completed' alike.

create or replace function public.sweep_session_status()
returns void language sql security definer set search_path = public as $$
  update class_sessions set status = 'completed'
  where status = 'scheduled' and ends_at < now();
$$;

comment on function public.sweep_session_status() is
  'Closes past scheduled sessions to completed, hourly. Deliberately does NOT default un-marked attendance — see migration 0065.';

-- ── Schedule it ─────────────────────────────────────────────────────────────
-- The line 0006 wrote down and never ran. `cron.schedule` upserts by job name,
-- so replaying this file re-points the existing job rather than adding a second.
-- It touches only its own row: the notify-worker job carries a service-role JWT
-- in its command and is left exactly as it is.

select cron.schedule('session-status-hourly', '5 * * * *',
  $$select public.sweep_session_status()$$);
