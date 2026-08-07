// Grouping sessions into days, and the order a week is read in.
//
// Only the date grouping is shared — This week uses it twice, for the phone's
// day cards and again inside each coach's lane on the desktop. The timetable
// deliberately keeps its own bucketing: it groups TWO kinds of row (classes and
// a family's weekly private slot) under each weekday, and a generic helper bent
// to cover that came out longer than the loop it replaced. A shared function
// that costs more than the duplication it removes is not reuse.

import { formatDay, sessionTimeStatus, wallDate } from "@/lib/academy-time";
import { WEEKDAYS } from "@/components/app/admin-calendar-types";

/** MO..SU, in the order a week is read. */
export const WEEKDAY_ORDER: string[] = WEEKDAYS.map(([code]) => code);

export type DayGroup<T> = {
  /** The academy wall date, "YYYY-MM-DD". */
  key: string;
  /** "Mon 11 Aug" — what the heading prints. */
  label: string;
  isToday: boolean;
  rows: T[];
};

type Timed = { starts_at: string; ends_at: string };

/**
 * Bucket sessions by academy wall date. Rows must arrive sorted by start time
 * (every query that feeds this orders by `starts_at`), so days come out in
 * calendar order with each day's rows already in order.
 *
 * Within a day, finished sessions sink to the bottom: at 4pm the founder is
 * looking for what is still to come, not what he already ran.
 */
export function groupSessionsByDay<T extends Timed>(rows: T[], today: string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const s of rows) {
    const key = wallDate(s.starts_at);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: formatDay(s.starts_at), isToday: key === today, rows: [] };
      groups.push(g);
    }
    g.rows.push(s);
  }
  const done = (s: Timed) => sessionTimeStatus(s.starts_at, s.ends_at) === "completed";
  for (const g of groups) {
    g.rows = [...g.rows.filter((s) => !done(s)), ...g.rows.filter(done)];
  }
  return groups;
}

