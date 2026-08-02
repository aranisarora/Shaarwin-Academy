// Clearing a timetable from the Weekly classes tab (bulkRemoveClassesCore).
//
// Two things are under test and they pull in opposite directions:
//
//  1. The founder can wipe a selection in one go — never-booked classes are
//     deleted outright, booked ones can only be ended (history survives).
//  2. Doing that to twenty classes must not text a parent twenty times.
//
// (2) is the reason `endGroupClassesCore` exists instead of a loop over
// `endGroupClassCore`. Unlike `coach_changed` (collapsed per user per IST day by
// queue_coach_changed, migration 0043), `session_cancelled` has NO collapse at
// the queue site, and it is a TRANSACTIONAL type — so it skips quiet hours and
// the daily send cap and goes out on the next worker tick. A loop would have
// reproduced the Jul 22 mass-reassignment burst with cancellations instead.
// These tests pin the one-message-per-person guarantee to the bulk core.

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  bookSession,
  createClient,
  createCoach,
  createWeeklySlot,
  SEED,
} from "../../e2e/lib/scenario";
import { expectNotificationCount } from "../../e2e/lib/notifications";
import {
  bulkRemoveClassesCore,
  planClassRemovalCore,
} from "../../lib/admin-ops-classes";

const FOUNDER_EMAIL = "founder@sharwin.example";

/** The cores take the app's typed client; the harness hands out an untyped one
 * pointed at local Supabase. Same object, so narrow it at the boundary. */
const typed = (c: SupabaseClient) => c as unknown as SupabaseClient<Database>;

/** A fresh recurring group class, cloned from the seeded batch so venue,
 * capacity and duration are all realistic. */
async function createGroupClass(label: string, weekday = "MO"): Promise<string> {
  const db = admin();
  const { data: seed, error: seedErr } = await db
    .from("classes")
    .select("venue_id,capacity,duration_minutes,skill_level")
    .eq("id", SEED.groupClass)
    .single();
  if (seedErr || !seed) throw new Error(`seed class missing: ${seedErr?.message}`);

  const { data, error } = await db
    .from("classes")
    .insert({
      class_type: "group",
      title: label,
      skill_level: seed.skill_level,
      capacity: seed.capacity,
      duration_minutes: seed.duration_minutes,
      venue_id: seed.venue_id,
      recurrence_rule: `FREQ=WEEKLY;BYDAY=${weekday}`,
      starts_on: new Date().toISOString().slice(0, 10),
      created_by: SEED.founder,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createGroupClass: ${error?.message}`);
  return data.id as string;
}

const uniq = () => Math.random().toString(36).slice(2, 7);

describe("bulk class removal", () => {
  it("deletes never-booked classes outright and messages nobody", async () => {
    const db = admin();
    const coach = await createCoach();
    const tag = uniq();
    const ids = await Promise.all([
      createGroupClass(`Bulk empty A ${tag}`),
      createGroupClass(`Bulk empty B ${tag}`),
      createGroupClass(`Bulk empty C ${tag}`),
    ]);
    // Sessions but no bookings — the "created it by mistake" case. One coach
    // teaches all three, so they need distinct slots (coach_no_overlap).
    for (const [i, id] of ids.entries())
      await createWeeklySlot({ weeks: 2, classId: id, coachId: coach.id, istHour: 16 + i });

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await bulkRemoveClassesCore(typed(founder), SEED.founder, ids, false);

    expect(r.ok).toBe(true);
    expect(r.deleted).toBe(3);
    expect(r.ended).toBe(0);
    expect(r.kept).toBe(0);

    const { data: left } = await db.from("classes").select("id").in("id", ids);
    expect(left ?? []).toHaveLength(0);
    // Nobody booked, so nobody is owed a word — including the coach who was on
    // the sessions that went with them.
    await expectNotificationCount(db, { userId: coach.id, type: "session_cancelled" }, 0);
  });

  it("sends a parent booked across several ended classes ONE message", async () => {
    const db = admin();
    const coach = await createCoach();
    const tag = uniq();
    // 3 sessions in a week, so the parent needs the 3x plan to hold them all.
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan3x });

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const classId = await createGroupClass(`Bulk booked ${tag} ${i}`);
      const [session] = await createWeeklySlot({
        weeks: 1,
        classId,
        coachId: coach.id,
        firstInDays: 2 + i,
        istHour: 16 + i,
      });
      await bookSession({
        email: parent.email,
        sessionId: session.sessionId,
        playerId: parent.playerIds[0],
      });
      ids.push(classId);
    }

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await bulkRemoveClassesCore(typed(founder), SEED.founder, ids, true);

    expect(r.ok).toBe(true);
    // Every one of them had a booking, so none could be deleted outright.
    expect(r.deleted).toBe(0);
    expect(r.ended).toBe(3);
    expect(r.kept).toBe(0);

    // The guarantee: one row, not three. A loop over endGroupClassCore gives 3.
    const rows = await expectNotificationCount(
      db,
      { userId: parent.id, type: "session_cancelled" },
      1
    );
    // ...and it reads as the whole clear-out, naming one class and counting the
    // rest — the same grammar the collapsed coach_changed row uses.
    expect(rows[0].data.class_count).toBe(3);
    expect(rows[0].data.collapsed).toBe(true);
    expect(rows[0].body).toContain("2 other classes");
    expect(rows[0].title).toBe("Classes ended");

    // The coach was on all three; they hear once too.
    const coachRows = await expectNotificationCount(
      db,
      { userId: coach.id, type: "session_cancelled" },
      1
    );
    expect(coachRows[0].data.class_count).toBe(3);

    // History is intact and the classes are ended, not gone.
    const { data: left } = await db.from("classes").select("id,active,ends_on").in("id", ids);
    expect(left ?? []).toHaveLength(3);
    for (const c of left ?? []) {
      expect(c.active).toBe(false);
      expect(c.ends_on).not.toBeNull();
    }
  });

  it("keeps a single ended class's message specific", async () => {
    // The collapse must not flatten the ordinary one-class case into vague copy.
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan1x });
    const title = `Bulk solo ${uniq()}`;
    const classId = await createGroupClass(title);
    const [session] = await createWeeklySlot({ weeks: 1, classId, coachId: coach.id });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await bulkRemoveClassesCore(typed(founder), SEED.founder, [classId], true);
    expect(r.ended).toBe(1);

    const rows = await expectNotificationCount(
      db,
      { userId: parent.id, type: "session_cancelled" },
      1
    );
    expect(rows[0].title).toBe("Class ended");
    expect(rows[0].body).toContain(title);
    expect(rows[0].body).not.toContain("other class");
    expect(rows[0].data.collapsed).toBe(false);
  });

  it("leaves booked classes untouched when the founder only wants the empty ones", async () => {
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan1x });
    const tag = uniq();

    const bookedClass = await createGroupClass(`Bulk mixed booked ${tag}`);
    const [session] = await createWeeklySlot({
      weeks: 1,
      classId: bookedClass,
      coachId: coach.id,
    });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });
    const emptyClass = await createGroupClass(`Bulk mixed empty ${tag}`);
    await createWeeklySlot({ weeks: 1, classId: emptyClass, coachId: coach.id, firstInDays: 5 });

    const founder = await asUser(FOUNDER_EMAIL);

    // The preview the confirm sheet shows must split them the same way.
    const plan = await planClassRemovalCore(typed(founder), [emptyClass, bookedClass]);
    expect(plan.deletable).toEqual([emptyClass]);
    expect(plan.booked).toEqual([bookedClass]);

    const r = await bulkRemoveClassesCore(
      typed(founder),
      SEED.founder,
      [emptyClass, bookedClass],
      false
    );
    expect(r.deleted).toBe(1);
    expect(r.ended).toBe(0);
    expect(r.kept).toBe(1);

    // The booked one is still running and its parent was never told anything.
    const { data: still } = await db
      .from("classes")
      .select("id,active")
      .eq("id", bookedClass)
      .single();
    expect(still?.active).toBe(true);
    await expectNotificationCount(db, { userId: parent.id, type: "session_cancelled" }, 0);
  });
});
