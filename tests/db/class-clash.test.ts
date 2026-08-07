// Publishing a weekly class when the coach's diary is not empty.
//
// This used to be the worst failure in the admin. Every occurrence of a new
// class went in as ONE array insert, and `coach_no_overlap` is a non-deferrable
// EXCLUDE — so a single week where the chosen coach was already booked aborted
// all nine rows. The `classes` row is written by a separate PostgREST call, so
// it had already been committed in its own transaction, and nothing took it
// back out. The founder was left holding a class with zero sessions, told to
// "pick a different coach in the calendar" when the calendar had nothing of his
// in it to pick. It did not heal either: `generate_class_sessions` is on no
// cron job, so the empty class sat there until somebody found the manual
// top-up.
//
// The rule these cases pin down: the SLOT is what the founder is creating. One
// busy week is a fact about a coach's diary, not a reason the Tuesday class
// cannot exist. So the class is always published in full, the weeks that coach
// can take are his, and the rest go out for the assignment engine — and the
// count of those comes back so the ✓ can say so out loud.

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import { admin } from "../../e2e/lib/supabase";
import { createCoach, createGroupSession, SEED } from "../../e2e/lib/scenario";
import { createGroupClassCore } from "../../lib/admin-ops";
import {
  academyToday,
  academyWallToUtc,
  shiftWallDate,
  utcToAcademyWall,
} from "../../lib/academy-time";

/** The cores take the app's typed client; the harness hands out an untyped
 *  service-role one. Same object — RLS is not what these cases are about. */
const founderClient = () => admin() as unknown as SupabaseClient<Database>;

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/** A late slot no seeded batch occupies (0009 runs 18:15 / 19:15), so a clash
 *  in these cases is only ever one we staged on purpose. */
const TIME = "21:15";

/**
 * The occurrences the core will build for a slot, worked out independently
 * here: every matching weekday inside the next 8 weeks that is still ahead of
 * us, on the ACADEMY wall clock. Duplicating the rule rather than importing it
 * is deliberate — a test that borrows the implementation's arithmetic cannot
 * catch the implementation getting that arithmetic wrong.
 */
function occurrencesFor(weekday: string, time: string): Date[] {
  const want = WEEKDAY_CODES.indexOf(weekday as (typeof WEEKDAY_CODES)[number]) + 1;
  const now = new Date();
  const out: Date[] = [];
  for (let d = 0; d <= 56; d++) {
    const dateStr = shiftWallDate(academyToday(), d);
    const [y, mo, dd] = dateStr.split("-").map(Number);
    const isoDow = ((new Date(Date.UTC(y, mo - 1, dd)).getUTCDay() + 6) % 7) + 1;
    if (isoDow !== want) continue;
    const start = academyWallToUtc(dateStr, time);
    if (start <= now) continue;
    out.push(start);
  }
  return out;
}

/** A weekday far enough out that "today, already gone" can never be the first
 *  occurrence — which would make the expected count depend on the clock. */
function weekdayInDays(days: number): string {
  const dateStr = shiftWallDate(academyToday(), days);
  const [y, mo, dd] = dateStr.split("-").map(Number);
  const isoDow = ((new Date(Date.UTC(y, mo - 1, dd)).getUTCDay() + 6) % 7) + 1;
  return WEEKDAY_CODES[isoDow - 1];
}

async function aVenueId(): Promise<string> {
  const { data, error } = await admin().from("venues").select("id").limit(1).single();
  if (error || !data) throw new Error(`no seeded venue: ${error?.message}`);
  return data.id as string;
}

async function sessionsOf(classId: string) {
  const { data, error } = await admin()
    .from("class_sessions")
    .select("id,starts_at,ends_at,coach_id,status")
    .eq("class_id", classId)
    .order("starts_at");
  if (error) throw new Error(`sessionsOf: ${error.message}`);
  return data ?? [];
}

/** Find the class the core just made — it returns no id, and the title is what
 *  the founder would recognise it by anyway. */
async function classIdByTitle(title: string): Promise<string> {
  const { data, error } = await admin()
    .from("classes")
    .select("id")
    .eq("title", title)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`class not found by title "${title}": ${error?.message}`);
  return data.id as string;
}

describe("publishing a weekly class over a coach's existing session", () => {
  it("still publishes every week, and puts the busy one out for a coach", async () => {
    const coach = await createCoach({ fullName: "Diary Clash Coach" });
    const weekday = weekdayInDays(3);
    const occ = occurrencesFor(weekday, TIME);
    expect(occ.length).toBeGreaterThanOrEqual(8);

    // The one week he genuinely cannot take: an existing session of his sitting
    // exactly on top of the second occurrence. Before the fix, this single row
    // is what destroyed all nine.
    const blocked = occ[1];
    await createGroupSession({ startsAt: blocked, coachId: coach.id });

    const title = `Clash Case ${Date.now()}`;
    const r = await createGroupClassCore(founderClient(), SEED.founder, {
      title,
      description: "",
      skillLevel: "any",
      capacity: 8,
      durationMinutes: 60,
      venueId: await aVenueId(),
      weekday,
      time: TIME,
      coachId: coach.id,
    });

    expect(r.ok).toBe(true);
    // The whole term is on the schedule — not zero, and not eight-of-nine.
    expect(r.weeks).toBe(occ.length);
    expect(r.coachless).toBeGreaterThanOrEqual(1);

    const classId = await classIdByTitle(title);
    const rows = await sessionsOf(classId);
    expect(rows).toHaveLength(occ.length);

    // The blocked week is not his — the database would not have allowed it, and
    // that is precisely why it must not have taken the class down with it.
    const blockedRow = rows.find(
      (s) => new Date(s.starts_at).getTime() === blocked.getTime()
    );
    expect(blockedRow).toBeDefined();
    expect(blockedRow!.coach_id).not.toBe(coach.id);

    // Every other week IS his. A fix that quietly dropped the coach from all
    // nine weeks would satisfy everything above and still be wrong.
    const others = rows.filter(
      (s) => new Date(s.starts_at).getTime() !== blocked.getTime()
    );
    expect(others.every((s) => s.coach_id === coach.id)).toBe(true);
  });

  it("never leaves a class behind with nothing on the schedule", async () => {
    // The orphan. Staged the hard way: the coach is busy on EVERY occurrence,
    // so under the old batched insert not one row could land while carrying
    // him — the exact shape that used to commit a class and then fail.
    const coach = await createCoach({ fullName: "Fully Booked Coach" });
    const weekday = weekdayInDays(4);
    const occ = occurrencesFor(weekday, TIME);
    for (const start of occ) {
      await createGroupSession({ startsAt: start, coachId: coach.id });
    }

    const title = `Orphan Case ${Date.now()}`;
    const r = await createGroupClassCore(founderClient(), SEED.founder, {
      title,
      description: "",
      skillLevel: "any",
      capacity: 8,
      durationMinutes: 60,
      venueId: await aVenueId(),
      weekday,
      time: TIME,
      coachId: coach.id,
    });

    expect(r.ok).toBe(true);
    const classId = await classIdByTitle(title);
    const rows = await sessionsOf(classId);
    // A class that exists has weeks. That is the whole invariant.
    expect(rows.length).toBe(occ.length);
    // And the founder is told how much of it his chosen coach could not take,
    // rather than reading a clean success over a term he is not on.
    expect(r.coachless).toBe(occ.length);
  });

  it("puts every week on the academy wall clock, whatever the server's own is", async () => {
    // The generator used to walk `new Date()` in the server's local calendar and
    // stamp starts_on from a UTC date string, so a region west of IST could drop
    // an occurrence and record a start date a day out.
    const weekday = weekdayInDays(5);
    const title = `Wall Clock Case ${Date.now()}`;
    const r = await createGroupClassCore(founderClient(), SEED.founder, {
      title,
      description: "",
      skillLevel: "any",
      capacity: 8,
      durationMinutes: 60,
      venueId: await aVenueId(),
      weekday,
      time: TIME,
    });
    expect(r.ok).toBe(true);

    const classId = await classIdByTitle(title);
    for (const s of await sessionsOf(classId)) {
      const wall = utcToAcademyWall(new Date(s.starts_at));
      expect(wall.time).toBe(TIME);
      expect(WEEKDAY_CODES[wall.isoWeekday - 1]).toBe(weekday);
    }

    const { data: cls } = await admin()
      .from("classes")
      .select("starts_on")
      .eq("id", classId)
      .single();
    expect(cls?.starts_on).toBe(academyToday());
  });

  it("reports nothing coachless when the coach was left on automatic", async () => {
    // `coachless` counts weeks a NAMED coach could not take. On automatic there
    // is no such promise to break, so the number must stay at zero rather than
    // reporting every week as a clash.
    const weekday = weekdayInDays(6);
    const title = `Automatic Case ${Date.now()}`;
    const r = await createGroupClassCore(founderClient(), SEED.founder, {
      title,
      description: "",
      skillLevel: "any",
      capacity: 8,
      durationMinutes: 60,
      venueId: await aVenueId(),
      weekday,
      time: TIME,
    });

    expect(r.ok).toBe(true);
    expect(r.coachless).toBe(0);
    expect(r.weeks).toBe(occurrencesFor(weekday, TIME).length);
  });
});
