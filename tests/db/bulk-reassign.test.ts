// notification-fix-plan 2.1 — bulk-operation suppression.
//
// The case study from the plan, asserted directly: re-assigning a coach across
// a whole series must produce ≤1 client message per household. On Jul 22 a
// single mass reassignment sent 376 coach_changed rows in one day because
// assignCoachToClass() loops founder_reassign() over every upcoming session and
// each call queued its own notification.
//
// These tests pin the collapse to the *queue site* (queue_coach_changed), not
// to the admin loops — so a future bulk path inherits the guarantee instead of
// rediscovering the bug.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  createClient,
  createCoach,
  createWeeklySlot,
  bookSession,
  SEED,
} from "../../e2e/lib/scenario";
import { expectNotificationCount } from "../../e2e/lib/notifications";

const FOUNDER_EMAIL = "founder@sharwin.example";

describe("bulk reassignment (migration 0043)", () => {
  it("sends ONE message per household when a coach changes across a whole series", async () => {
    const db = admin();
    const oldCoach = await createCoach();
    const newCoach = await createCoach();
    // A weekly plan, so the parent can hold all four occurrences (one a week).
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan1x });

    // A four-week recurring slot, all taught by the same coach.
    const sessions = await createWeeklySlot({ weeks: 4, coachId: oldCoach.id });
    for (const s of sessions) {
      await bookSession({
        email: parent.email,
        sessionId: s.sessionId,
        playerId: parent.playerIds[0],
      });
    }

    // The bulk operation: exactly what assignCoachToClass() does — loop
    // founder_reassign over every upcoming session in the class.
    const founder = await asUser(FOUNDER_EMAIL);
    for (const s of sessions) {
      const { error } = await founder.rpc("founder_reassign", {
        p_session: s.sessionId,
        p_coach: newCoach.id,
        p_lock: false,
        p_force: true,
      });
      expect(error).toBeNull();
    }

    // Before 0043 this was 4 rows ("Meet your new coach", once per session).
    const rows = await expectNotificationCount(
      db,
      { userId: parent.id, type: "coach_changed" },
      1
    );
    // ...and it reads as a summary, not as a single session's change.
    expect(rows[0].data.change_count).toBe(4);
    expect(rows[0].data.collapsed).toBe(true);
    expect(rows[0].body).toContain("4 of your sessions");
  });

  it("collapses the receiving coach's copy too — they get one summary, not N", async () => {
    const db = admin();
    const oldCoach = await createCoach();
    const newCoach = await createCoach();
    const sessions = await createWeeklySlot({ weeks: 3, coachId: oldCoach.id });

    const founder = await asUser(FOUNDER_EMAIL);
    for (const s of sessions) {
      await founder.rpc("founder_reassign", {
        p_session: s.sessionId,
        p_coach: newCoach.id,
        p_lock: false,
        p_force: true,
      });
    }

    await expectNotificationCount(db, { userId: newCoach.id, type: "coach_changed" }, 1);
    await expectNotificationCount(db, { userId: oldCoach.id, type: "coach_changed" }, 1);
  });

  it("still tells a single-session reassignment exactly what changed", async () => {
    // The collapse must not flatten the ordinary case into vague copy — steady
    // state is 2–9 changes a day and those should stay specific.
    const db = admin();
    const oldCoach = await createCoach();
    const newCoach = await createCoach();
    const parent = await createClient({ children: 1 });
    const [session] = await createWeeklySlot({ weeks: 1, coachId: oldCoach.id });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });

    const founder = await asUser(FOUNDER_EMAIL);
    await founder.rpc("founder_reassign", {
      p_session: session.sessionId,
      p_coach: newCoach.id,
      p_lock: false,
      p_force: true,
    });

    const rows = await expectNotificationCount(
      db,
      { userId: parent.id, type: "coach_changed" },
      1
    );
    expect(rows[0].title).toBe("Meet your new coach");
    expect(rows[0].data.collapsed).toBeUndefined();
    expect(rows[0].data.session_id).toBe(session.sessionId);
  });

  it("holds the change briefly so a burst lands together", async () => {
    // The 2-minute delay is what makes the collapse reliable: without it the
    // worker (1-minute cron) could deliver row 1 before row 2 is queued.
    const db = admin();
    const oldCoach = await createCoach();
    const newCoach = await createCoach();
    const [session] = await createWeeklySlot({ weeks: 1, coachId: oldCoach.id });

    const founder = await asUser(FOUNDER_EMAIL);
    await founder.rpc("founder_reassign", {
      p_session: session.sessionId,
      p_coach: newCoach.id,
      p_lock: false,
      p_force: true,
    });

    const { data } = await db
      .from("notifications")
      .select("scheduled_for")
      .eq("user_id", newCoach.id)
      .eq("type", "coach_changed")
      .single();
    const delayMs = new Date(data!.scheduled_for).getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(30_000);
  });
});
