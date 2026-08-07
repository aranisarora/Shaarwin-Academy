// The arithmetic behind "what would this slot land on" — shared by the thing
// that PREVIEWS a clash and the thing that actually writes the sessions.
//
// It lives in its own module for one reason: those two must never disagree. A
// preview that computes its occurrences even slightly differently from the
// insert is worse than no preview at all — it tells the founder a confident
// story about weeks that were never going to exist. So the loop is written
// once, here, and both sides import it.
//
// Pure: no Supabase, no clock beyond the `now` you hand it. That is what lets
// it be unit-tested across the IST midnight boundary, which is where the old
// server-local version quietly gained or lost a week.

import { academyToday, academyWallToUtc, shiftWallDate } from "@/lib/academy-time";

/** MO..SU, indexed by ISO weekday - 1. */
export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/**
 * ISO weekday (1=Mon..7=Sun) of a bare "YYYY-MM-DD" wall date.
 *
 * Built in UTC on purpose. A calendar date has no timezone, so constructing it
 * with `new Date(y, m, d)` would read the SERVER's zone and could answer with
 * the day before.
 */
export function isoWeekdayOfWallDate(dateStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return ((new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/**
 * The instants a repeating weekly class would occupy: every matching weekday
 * inside the next `weeks` weeks that is still ahead of `now`, on the academy
 * wall clock.
 *
 * Walking wall DATES and converting each to an instant — rather than adding
 * 7×86400000ms to a starting instant — is what keeps every occurrence at the
 * same wall-clock time. (IST has no DST today, so the two agree; doing it the
 * fragile way anyway is how a timezone bug waits for a policy change.)
 */
export function weeklyOccurrences(
  weekday: string,
  time: string,
  weeks = 8,
  now: Date = new Date()
): Date[] {
  const want = (WEEKDAY_CODES as readonly string[]).indexOf(weekday) + 1;
  if (want === 0) return [];
  const from = academyToday(now);
  const out: Date[] = [];
  for (let d = 0; d <= weeks * 7; d++) {
    const dateStr = shiftWallDate(from, d);
    if (isoWeekdayOfWallDate(dateStr) !== want) continue;
    const start = academyWallToUtc(dateStr, time);
    if (start <= now) continue;
    out.push(start);
  }
  return out;
}

/**
 * Do two half-open intervals overlap? Half-open is the point: a class ending at
 * 7:30 and one starting at 7:30 are back to back, not a clash, and this is the
 * same rule Postgres applies — `tstzrange(a, b)` defaults to `[)`, so the
 * `coach_no_overlap` EXCLUDE agrees with this function by construction.
 */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
