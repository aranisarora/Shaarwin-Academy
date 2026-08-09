// Migration 0069 — `session_unassigned` stops shouting.
//
// Production, the fourteen days to 2026-08-08: 105 messages about 18 sessions
// in one IST day, 120 about 12 in another. Two multipliers, and the tests below
// pin one guarantee against each:
//
//   * assign_coach() re-announces an unchanged condition every time any
//     scheduling path re-runs it — one session produced 15 rows in twenty
//     minutes. → "the same session is announced once".
//   * every unassigned session fans out to every founder. → "a burst becomes
//     one message".
//
// Both are pinned at the queue site (queue_session_alert), not at assign_coach,
// so a future writer inherits them instead of rediscovering the bug — the same
// reasoning as 0043 and its bulk-reassign spec.
//
// The third test is what makes the batching delay defensible: a session that
// gets a coach must drop out of an alert that hasn't gone out yet, or the
// founder fixes three gaps and is told about them ten minutes later.

import { describe, it, expect, beforeEach } from "vitest";
import { admin } from "../../e2e/lib/supabase";
import { createCoach, createGroupSession, hoursFromNow } from "../../e2e/lib/scenario";
import { expectNotificationCount } from "../../e2e/lib/notifications";

const db = admin();

async function founderIds(): Promise<string[]> {
  const { data, error } = await db
    .from("profiles")
    .select("id")
    .eq("role", "founder")
    .is("deleted_at", null);
  if (error) throw new Error(`founderIds: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length === 0) throw new Error("no founders seeded — the alert has no audience");
  return ids;
}

/**
 * rank_coaches() draws from `coaches where active` (schema.sql), so switching
 * every coach off is the one lever that makes a session genuinely unassignable
 * regardless of what availability the seed happens to carry. Restored in a
 * finally so a failure can't leak into the next file.
 */
async function withNoEligibleCoach<T>(fn: () => Promise<T>): Promise<T> {
  const { data: before, error } = await db.from("coaches").select("id").eq("active", true);
  if (error) throw new Error(`withNoEligibleCoach: ${error.message}`);
  const wasActive = (before ?? []).map((c) => c.id as string);
  await db.from("coaches").update({ active: false }).eq("active", true);
  try {
    return await fn();
  } finally {
    if (wasActive.length) {
      await db.from("coaches").update({ active: true }).in("id", wasActive);
    }
  }
}

/** A future group session with nobody on it and no alert history. */
async function unassignableSession(hours = 48) {
  const s = await createGroupSession({ startsAt: hoursFromNow(hours) });
  await db.from("class_sessions").update({ coach_id: null }).eq("id", s.sessionId);
  await db
    .from("coach_assignments")
    .update({ status: "superseded" })
    .eq("session_id", s.sessionId)
    .eq("status", "active");
  return s;
}

// The collapse is deliberately per-founder-per-IST-day, so rows left by an
// earlier test in this file would absorb the next test's sessions and make the
// counts meaningless. Clearing the type is safe: the suite rebuilds the DB from
// schema.sql once per run and nothing else asserts on these rows.
beforeEach(async () => {
  await db.from("notifications").delete().eq("type", "session_unassigned");
});

describe("session_unassigned collapse (migration 0069)", () => {
  it("announces the same session once, however many times assignment re-runs", async () => {
    const [founder] = await founderIds();

    await withNoEligibleCoach(async () => {
      const session = await unassignableSession();

      // Exactly the production shape: every scheduling path that touches this
      // session re-runs assignment and fails again.
      for (let i = 0; i < 5; i++) {
        const { error } = await db.rpc("assign_coach", { p_session: session.sessionId });
        expect(error).toBeNull();
      }

      // Before 0069 this was five rows per founder. The condition didn't change
      // five times — it never changed at all.
      const rows = await expectNotificationCount(
        db,
        { userId: founder, type: "session_unassigned" },
        1
      );
      expect(rows[0].data.alert_count).toBe(1);
      expect(rows[0].data.collapsed).toBe(false);
      // Still deep-links to the session the founder has to fix.
      expect(rows[0].data.session_id).toBe(session.sessionId);
    });
  });

  it("folds a bulk unassignment into one message per founder", async () => {
    const founders = await founderIds();

    await withNoEligibleCoach(async () => {
      const sessions = [];
      for (let i = 0; i < 4; i++) sessions.push(await unassignableSession(48 + i * 24));

      for (const s of sessions) {
        const { error } = await db.rpc("assign_coach", { p_session: s.sessionId });
        expect(error).toBeNull();
      }

      // One summary each, not four messages each.
      for (const founder of founders) {
        const rows = await expectNotificationCount(
          db,
          { userId: founder, type: "session_unassigned" },
          1
        );
        expect(rows[0].data.alert_count).toBe(4);
        expect(rows[0].data.collapsed).toBe(true);
        expect(rows[0].title).toBe("4 sessions need a coach");
        // Names one and counts the rest — the 0055 house style.
        expect(rows[0].body).toContain("3 other sessions");
        expect((rows[0].data.session_ids as string[]).sort()).toEqual(
          sessions.map((s) => s.sessionId).sort()
        );
      }
    });
  });

  it("drops a session from an alert that hasn't gone out once it has a coach", async () => {
    const [founder] = await founderIds();
    const coach = await createCoach();

    const sessions = await withNoEligibleCoach(async () => {
      const made = [await unassignableSession(48), await unassignableSession(72)];
      for (const s of made) {
        await db.rpc("assign_coach", { p_session: s.sessionId });
      }
      return made;
    });

    // Both sessions are in one pending alert.
    let rows = await expectNotificationCount(
      db,
      { userId: founder, type: "session_unassigned" },
      1
    );
    expect(rows[0].data.alert_count).toBe(2);

    // The founder fixes one. The message must stop claiming it needs a coach.
    await db
      .from("class_sessions")
      .update({ coach_id: coach.id })
      .eq("id", sessions[0].sessionId);

    rows = await expectNotificationCount(db, { userId: founder, type: "session_unassigned" }, 1);
    expect(rows[0].data.alert_count).toBe(1);
    expect(rows[0].data.collapsed).toBe(false);
    expect((rows[0].data.session_ids as string[])).toEqual([sessions[1].sessionId]);
    expect(rows[0].data.session_id).toBe(sessions[1].sessionId);

    // ...and when the last one is fixed there is nothing left to say. The row
    // never went out, so it is deleted rather than delivered as a lie.
    await db
      .from("class_sessions")
      .update({ coach_id: coach.id })
      .eq("id", sessions[1].sessionId);

    await expectNotificationCount(db, { userId: founder, type: "session_unassigned" }, 0);
  });

  it("schedules an imminent session ahead of a distant one", async () => {
    const [founder] = await founderIds();

    // A session starting inside 6 hours gets the 2-minute burst window; a
    // distant one waits 10 minutes so a bulk operation can land in one message.
    await withNoEligibleCoach(async () => {
      const soon = await unassignableSession(3);
      await db.rpc("assign_coach", { p_session: soon.sessionId });
    });

    const rows = await expectNotificationCount(
      db,
      { userId: founder, type: "session_unassigned" },
      1
    );
    const delayMs = new Date(rows[0].scheduled_for).getTime() - new Date(rows[0].created_at).getTime();
    expect(delayMs).toBeLessThan(5 * 60_000);
  });
});
