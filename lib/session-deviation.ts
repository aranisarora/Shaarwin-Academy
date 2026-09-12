// Telling "this is the class we always run" apart from "this week it moved".
//
// This is the fix for the thing that made the schedule untrustworthy. Sessions
// get cancelled and moved constantly, and the schedule showed neither: a
// cancelled class was filtered out of the query entirely, so Tuesday simply
// looked like a day we don't run, and a moved one appeared at its new time with
// nothing to say it had ever been anywhere else. There was no way to read the
// standing pattern off the week, which is why a whole second tab had to exist
// to hold it.
//
// A moved session is still happening, so it stays in the list where the founder
// will trip over it, wearing a line that says where it came from. A cancelled
// one is not happening, so it drops into a collapsed line under its day — the
// day still says something happened to it, without a dead card in the flow.

import { wallDate, wallTime } from "@/lib/academy-time";
import { weekdayOfDate } from "@/components/app/admin-calendar-types";

/**
 * The slot a class actually runs at, as the mode over its own future sessions.
 *
 * The recurrence rule stores the weekday and nothing else — there is no
 * canonical time column anywhere — so the sessions themselves are the only
 * record of the slot. The mode is what makes that safe: one session moved to
 * Thursday cannot outvote the seven still sitting on Monday, whereas "the next
 * one" (what every other read-time surface uses) is wrong precisely when the
 * next one is the moved one.
 */
export function modalTimeByClass(
  rows: { class_id: string; starts_at: string }[]
): Record<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const t = wallTime(r.starts_at);
    let byTime = counts.get(r.class_id);
    if (!byTime) counts.set(r.class_id, (byTime = new Map()));
    byTime.set(t, (byTime.get(t) ?? 0) + 1);
  }
  const out: Record<string, string> = {};
  for (const [classId, byTime] of counts) {
    let best = "";
    let bestN = 0;
    for (const [time, n] of byTime) {
      if (n > bestN) {
        best = time;
        bestN = n;
      }
    }
    if (best) out[classId] = best;
  }
  return out;
}

export type Deviation = {
  /** The weekday the class normally runs on, MO..SU. */
  weekday: string;
  /** The time it normally runs at, "HH:MM". */
  time: string;
  movedDay: boolean;
  movedTime: boolean;
};

/**
 * Where this session sits relative to its class's standing slot, or null if it
 * is exactly where you would expect it.
 *
 * Only ever answers for a repeating class. A one-off runs on a date and has no
 * pattern to deviate from, so flagging one would be inventing a rule it never
 * had — which is the same mistake as the old "18:30" fallback that rewrote
 * every ended class's real time.
 */
export function sessionDeviation(s: {
  starts_at: string;
  classRecurring: boolean;
  classWeekday: string;
  classSlotTime: string | null;
}): Deviation | null {
  if (!s.classRecurring || !s.classSlotTime) return null;
  const movedDay = weekdayOfDate(wallDate(s.starts_at)) !== s.classWeekday;
  const movedTime = wallTime(s.starts_at) !== s.classSlotTime;
  if (!movedDay && !movedTime) return null;
  return { weekday: s.classWeekday, time: s.classSlotTime, movedDay, movedTime };
}
