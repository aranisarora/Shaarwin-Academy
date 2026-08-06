// Clearing a timetable from the Weekly classes tab (bulkRemoveClassesCore).
//
// Two things are under test and they pull in opposite directions:
//
//  1. The founder can wipe a selection in one go — classes holding nothing are
//     deleted outright, and every other bucket can leave the list too: a booked
//     class can be ended, or ended and deleted, and an already-ended one can be
//     deleted together with the history it still holds. He is the admin; no
//     class is allowed to be stuck.
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
  deleteGroupClassCore,
  endGroupClassesCore,
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

/** A private class row — the kind of id that used to slip into `endable` and
 * abort a removal that had nothing to do with it. No sessions: the point is the
 * id, not the schedule behind it. */
async function createPrivateClass(label: string): Promise<string> {
  const { data, error } = await admin()
    .from("classes")
    .insert({
      class_type: "private",
      title: label,
      skill_level: "beginner",
      capacity: 1,
      duration_minutes: 60,
      starts_on: new Date().toISOString().slice(0, 10),
      created_by: SEED.founder,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createPrivateClass: ${error?.message}`);
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
    const r = await bulkRemoveClassesCore(typed(founder), SEED.founder, ids, {});

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
    const r = await bulkRemoveClassesCore(typed(founder), SEED.founder, ids, {
      endBooked: true,
    });

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
    const r = await bulkRemoveClassesCore(typed(founder), SEED.founder, [classId], {
      endBooked: true,
    });
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

  // ── The dead end this feature shipped with ────────────────────────────────
  // Prod had two group classes, both already ended (every future session
  // cancelled), each still holding one confirmed booking on a PAST session.
  // The old guard counted bookings of any status on any session, so it refused
  // the delete and told the founder to "end it instead" — which he had already
  // done. Neither action was available and the classes could not leave the list.
  it("lets an already-ended class holding history be deleted, but only on purpose", async () => {
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan1x });
    const classId = await createGroupClass(`Bulk ended ${uniq()}`);
    const [session] = await createWeeklySlot({ weeks: 1, classId, coachId: coach.id });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });

    const founder = await asUser(FOUNDER_EMAIL);
    // End it first — the normal path, history preserved.
    await bulkRemoveClassesCore(typed(founder), SEED.founder, [classId], { endBooked: true });
    // ...then flip the booking back to a live status so the class still holds
    // history, which is the state the two prod classes were stuck in.
    await db
      .from("bookings")
      .update({ status: "attended", cancelled_at: null, cancel_reason: null })
      .eq("session_id", session.sessionId);

    const plan = await planClassRemovalCore(typed(founder), [classId]);
    expect(plan.purgeable).toEqual([classId]);
    expect(plan.endable).toEqual([]);
    expect(plan.deletable).toEqual([]);
    // The warning has to be able to quote a real price.
    expect(plan.purgeCost.bookings).toBeGreaterThan(0);
    expect(plan.purgeCost.sessions).toBeGreaterThan(0);

    // Without the opt-in it stays put — no silent history loss.
    const held = await bulkRemoveClassesCore(typed(founder), SEED.founder, [classId], {});
    expect(held.deleted).toBe(0);
    expect(held.purged).toBe(0);
    expect(held.kept).toBe(1);
    const { data: stillThere } = await db.from("classes").select("id").eq("id", classId);
    expect(stillThere ?? []).toHaveLength(1);

    // With it, the class finally leaves the list.
    const gone = await bulkRemoveClassesCore(typed(founder), SEED.founder, [classId], {
      purgeEnded: true,
    });
    expect(gone.purged).toBe(1);
    expect(gone.kept).toBe(0);
    const { data: left } = await db.from("classes").select("id").eq("id", classId);
    expect(left ?? []).toHaveLength(0);
  });

  it("asks once more before deleting a class that holds bookings, running or ended", async () => {
    // The single-class "Delete completely" link, which is where he hit the wall.
    // Neither state is allowed to be a dead end: a running class used to be told
    // "end it instead" and an ended one used to be told the same thing, which it
    // had already done. Both now name their cost and ask for `force` — one code,
    // one shape, so the sheet has one branch to handle.
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan1x });
    const classId = await createGroupClass(`Solo ended ${uniq()}`);
    const [session] = await createWeeklySlot({ weeks: 1, classId, coachId: coach.id });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });
    const founder = await asUser(FOUNDER_EMAIL);

    const running = await deleteGroupClassCore(typed(founder), SEED.founder, classId);
    expect(running.ok).toBe(false);
    expect(running.code).toBe("needs_force");
    expect(running.error).not.toContain("End it instead");
    // It has to say what confirming costs: the cancellation AND the message.
    expect(running.error).toContain("cancels");
    expect(running.error).toContain("tells everyone");

    await bulkRemoveClassesCore(typed(founder), SEED.founder, [classId], { endBooked: true });
    await db
      .from("bookings")
      .update({ status: "attended", cancelled_at: null, cancel_reason: null })
      .eq("session_id", session.sessionId);

    // Now that it IS ended there is nothing left to cancel, so the same refusal
    // asks about the history instead — and never about ending it again.
    const ended = await deleteGroupClassCore(typed(founder), SEED.founder, classId);
    expect(ended.ok).toBe(false);
    expect(ended.code).toBe("needs_force");
    expect(ended.error).not.toContain("End it instead");
    expect(ended.error).toContain("on record");

    const forced = await deleteGroupClassCore(typed(founder), SEED.founder, classId, true);
    expect(forced.ok).toBe(true);
    const { data: left } = await db.from("classes").select("id").eq("id", classId);
    expect(left ?? []).toHaveLength(0);
  });

  it("deletes a RUNNING booked class on force, telling each person exactly once", async () => {
    // "As an admin I should have all control over any class." A class people are
    // on can't just vanish, so force ends it first — but the courtesy is one
    // message per person, not one per session, even though this parent holds
    // three weeks of it.
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan1x });
    const classId = await createGroupClass(`Force running ${uniq()}`);
    const sessions = await createWeeklySlot({ weeks: 3, classId, coachId: coach.id });
    for (const s of sessions)
      await bookSession({
        email: parent.email,
        sessionId: s.sessionId,
        playerId: parent.playerIds[0],
      });

    const founder = await asUser(FOUNDER_EMAIL);
    // It is running and people are on it, so the plan offers it as endable.
    const plan = await planClassRemovalCore(typed(founder), [classId]);
    expect(plan.endable).toEqual([classId]);

    const forced = await deleteGroupClassCore(typed(founder), SEED.founder, classId, true);
    expect(forced.ok).toBe(true);
    expect(forced.cancelledBookings).toBeGreaterThan(0);

    const { data: left } = await db.from("classes").select("id").eq("id", classId);
    expect(left ?? []).toHaveLength(0);

    const rows = await expectNotificationCount(
      db,
      { userId: parent.id, type: "session_cancelled" },
      1
    );
    expect(rows[0].title).toBe("Class ended");
    // The coach loses three sessions and hears about it once as well.
    await expectNotificationCount(db, { userId: coach.id, type: "session_cancelled" }, 1);
  });

  it("ends AND deletes booked classes in one pass when the founder asks for that", async () => {
    // The dead end the sheet shipped with: ticking "also end" removed nothing,
    // because `endable` was the one bucket no delete ever touched. The founder
    // had asked for the class to go and watched it stay.
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan1x });
    const classId = await createGroupClass(`Bulk delete booked ${uniq()}`);
    const [session] = await createWeeklySlot({ weeks: 1, classId, coachId: coach.id });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await bulkRemoveClassesCore(typed(founder), SEED.founder, [classId], {
      deleteBooked: true,
    });

    expect(r.ok).toBe(true);
    expect(r.deletedBooked).toBe(1);
    // It was ended on the way out, but it is reported as deleted, not as ended —
    // counting it twice would overstate what the founder still has.
    expect(r.ended).toBe(0);
    expect(r.deleted).toBe(0);
    expect(r.kept).toBe(0);

    const { data: left } = await db.from("classes").select("id").eq("id", classId);
    expect(left ?? []).toHaveLength(0);

    // Deleting is not a way to skip telling people.
    const rows = await expectNotificationCount(
      db,
      { userId: parent.id, type: "session_cancelled" },
      1
    );
    expect(rows[0].data.collapsed).toBe(false);
  });

  it("doesn't let one class that can't be ended hold back the rest of a selection", async () => {
    // A selection is a mixed bag and one awkward id must not stop the rest.
    // `endGroupClassesCore` ends group classes and refuses outright when handed
    // a list matching none, so a private class landing in `endable` would abort
    // the whole removal — including never-booked classes that were safe to go.
    // The plan filters to group classes, so it never gets there.
    const db = admin();
    const coach = await createCoach();
    const tag = uniq();
    const emptyA = await createGroupClass(`Mixed empty A ${tag}`);
    const emptyB = await createGroupClass(`Mixed empty B ${tag}`);
    const privateId = await createPrivateClass(`Mixed private ${tag}`);
    await createWeeklySlot({ weeks: 1, classId: emptyA, coachId: coach.id, istHour: 17 });
    await createWeeklySlot({
      weeks: 1,
      classId: emptyB,
      coachId: coach.id,
      istHour: 18,
      firstInDays: 4,
    });

    const founder = await asUser(FOUNDER_EMAIL);
    const plan = await planClassRemovalCore(typed(founder), [emptyA, emptyB, privateId]);
    expect(plan.deletable.sort()).toEqual([emptyA, emptyB].sort());
    expect(plan.endable).toEqual([]);

    const r = await bulkRemoveClassesCore(
      typed(founder),
      SEED.founder,
      [emptyA, emptyB, privateId],
      { endBooked: true }
    );
    expect(r.ok).toBe(true);
    expect(r.deleted).toBe(2);
    expect(r.kept).toBe(0);
    const { data: left } = await db.from("classes").select("id").in("id", [emptyA, emptyB]);
    expect(left ?? []).toHaveLength(0);
    // The private class is managed from the Schedule tab, not from here, so it
    // is left exactly where it was rather than swept up.
    const { data: priv } = await db.from("classes").select("id").eq("id", privateId);
    expect(priv ?? []).toHaveLength(1);
  });

  it("lets go of a class whose only booking is a place on a session that has passed", async () => {
    // The two classes stuck on prod. Each was ended in August and still held one
    // 'confirmed' booking on a July session nothing ever settled — a place
    // nobody is waiting for, on an hour that has been and gone, which the guard
    // read as live history and would not let go of. Ending settles those
    // sessions, and a held place behind us stops counting.
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan1x });
    const classId = await createGroupClass(`Stale hold ${uniq()}`);
    const [session] = await createWeeklySlot({ weeks: 1, classId, coachId: coach.id });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });
    // Drag the session into the past with the booking still 'confirmed' — the
    // state a session reaches whenever nobody marks a register.
    const past = new Date(Date.now() - 14 * 86_400_000);
    await db
      .from("class_sessions")
      .update({
        starts_at: past.toISOString(),
        ends_at: new Date(past.getTime() + 3_600_000).toISOString(),
      })
      .eq("id", session.sessionId);

    const founder = await asUser(FOUNDER_EMAIL);
    const plan = await planClassRemovalCore(typed(founder), [classId]);
    expect(plan.deletable).toEqual([classId]);
    expect(plan.endable).toEqual([]);
    expect(plan.purgeable).toEqual([]);

    // It goes with one plain delete — no history warning, and nobody is told,
    // because there is nothing ahead of anyone to cancel.
    const gone = await bulkRemoveClassesCore(typed(founder), SEED.founder, [classId], {});
    expect(gone.deleted).toBe(1);
    const { data: left } = await db.from("classes").select("id").eq("id", classId);
    expect(left ?? []).toHaveLength(0);
    await expectNotificationCount(db, { userId: parent.id, type: "session_cancelled" }, 0);
  });

  it("settles the past when it ends a class, without inventing a register", async () => {
    // Cancelling the future was only ever half of ending a class. A session
    // whose hour passed while nobody marked anything stayed at 'scheduled',
    // which every screen reads as "still to come" — so an ended class went on
    // advertising a session from last month. Ending now marks those completed.
    // Their bookings are left alone on purpose: whether a child turned up is not
    // something we can work out at the moment a timetable is cleared, and
    // sweep_session_status is the one place that decides what an unmarked
    // register means.
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan2x });
    const classId = await createGroupClass(`Settle past ${uniq()}`);
    const [oldSession] = await createWeeklySlot({ weeks: 1, classId, coachId: coach.id });
    const [futureSession] = await createWeeklySlot({
      weeks: 1,
      classId,
      coachId: coach.id,
      firstInDays: 5,
      istHour: 19,
    });
    for (const s of [oldSession, futureSession])
      await bookSession({
        email: parent.email,
        sessionId: s.sessionId,
        playerId: parent.playerIds[0],
      });
    const past = new Date(Date.now() - 10 * 86_400_000);
    await db
      .from("class_sessions")
      .update({
        starts_at: past.toISOString(),
        ends_at: new Date(past.getTime() + 3_600_000).toISOString(),
      })
      .eq("id", oldSession.sessionId);

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await endGroupClassesCore(typed(founder), SEED.founder, [classId]);
    expect(r.ok).toBe(true);

    const { data: sessions } = await db
      .from("class_sessions")
      .select("id,status")
      .in("id", [oldSession.sessionId, futureSession.sessionId]);
    const byId = new Map((sessions ?? []).map((s) => [s.id, s.status]));
    expect(byId.get(oldSession.sessionId)).toBe("completed");
    expect(byId.get(futureSession.sessionId)).toBe("cancelled");

    const { data: oldBooking } = await db
      .from("bookings")
      .select("status")
      .eq("session_id", oldSession.sessionId)
      .single();
    expect(oldBooking?.status).toBe("confirmed");
    // Only the session somebody was still waiting for is cancelled for them.
    const { data: futureBooking } = await db
      .from("bookings")
      .select("status")
      .eq("session_id", futureSession.sessionId)
      .single();
    expect(futureBooking?.status).toBe("cancelled_by_academy");

    // With nothing live left, the ended class is a plain delete rather than a
    // history purge — which is how the two stuck classes get off the list.
    const plan = await planClassRemovalCore(typed(founder), [classId]);
    expect(plan.deletable).toEqual([classId]);
    expect(plan.purgeable).toEqual([]);
  });

  it("does not let a cancelled booking make a class undeletable forever", async () => {
    // A booking somebody cancelled is not attendance history, so it must not
    // count against the delete — otherwise one cancelled trial booking pins a
    // class to the list for good.
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan1x });
    const classId = await createGroupClass(`Bulk cancelled ${uniq()}`);
    const [session] = await createWeeklySlot({ weeks: 1, classId, coachId: coach.id });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });
    await db
      .from("bookings")
      .update({ status: "cancelled_by_client", cancelled_at: new Date().toISOString() })
      .eq("session_id", session.sessionId);

    const founder = await asUser(FOUNDER_EMAIL);
    const plan = await planClassRemovalCore(typed(founder), [classId]);
    expect(plan.deletable).toEqual([classId]);

    const r = await bulkRemoveClassesCore(typed(founder), SEED.founder, [classId], {});
    expect(r.deleted).toBe(1);
    const { data: left } = await db.from("classes").select("id").eq("id", classId);
    expect(left ?? []).toHaveLength(0);
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
    expect(plan.endable).toEqual([bookedClass]);
    expect(plan.purgeable).toEqual([]);

    const r = await bulkRemoveClassesCore(
      typed(founder),
      SEED.founder,
      [emptyClass, bookedClass],
      {}
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
