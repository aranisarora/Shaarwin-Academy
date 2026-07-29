// notification-fix-plan Phase 3 item 3 (K8) — cover offers, first-tap-wins.
//
// The claim is a race by design: several coaches get the same offer and the
// first to act takes it. "First tap wins" is only true if the row lock and the
// coach_id check actually hold, so the concurrent case is the test that matters
// — a second claim must FAIL, not silently overwrite the first coach.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  createClient,
  createCoach,
  createGroupSession,
  bookSession,
  SEED,
  hoursFromNow,
} from "../../e2e/lib/scenario";
import { expectNotification, expectNotificationCount } from "../../e2e/lib/notifications";

/**
 * A coach who is actually eligible for anything. createCoach() creates no
 * availability windows, and rank_coaches correctly excludes a coach with none —
 * so cover tests have to supply them or every claim fails `filter_failed_unavailable`.
 */
async function availableCoach() {
  const coach = await createCoach();
  const db = admin();
  const { error } = await db.from("coach_availability").insert(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      coach_id: coach.id,
      weekday,
      start_time: "00:00",
      end_time: "23:59",
    }))
  );
  if (error) throw new Error(`availableCoach: ${error.message}`);
  return coach;
}

/** An upcoming group session with nobody assigned to it. */
async function uncoveredSession() {
  const db = admin();
  const session = await createGroupSession({ startsAt: hoursFromNow(24) });
  await db.from("class_sessions").update({ coach_id: null }).eq("id", session.sessionId);
  await db
    .from("coach_assignments")
    .update({ status: "superseded" })
    .eq("session_id", session.sessionId)
    .eq("status", "active");
  return session;
}

describe("cover offers (K8)", () => {
  it("offers an uncovered session to eligible coaches", async () => {
    const db = admin();
    const coach = await availableCoach();
    const session = await uncoveredSession();

    const { data: offered, error } = await db.rpc("offer_cover_session", {
      p_session: session.sessionId,
    });
    expect(error).toBeNull();
    expect(Number(offered)).toBeGreaterThan(0);

    const offer = await expectNotification(db, {
      type: "cover_offer",
      userId: coach.id,
      dataContains: { session_id: session.sessionId },
    });
    // The coach needs to know what they'd be taking on before saying yes.
    expect(offer.data.class_title).toBeTruthy();
    expect(offer.data.time_str).toBeTruthy();
    expect(offer.data.location_str).toBeTruthy();
  });

  it("offers each coach the same session only once, however often it sweeps", async () => {
    const db = admin();
    const coach = await availableCoach();
    const session = await uncoveredSession();

    await db.rpc("offer_cover_session", { p_session: session.sessionId });
    const second = await db.rpc("offer_cover_session", { p_session: session.sessionId });
    expect(Number(second.data)).toBe(0);

    await expectNotificationCount(
      db,
      { type: "cover_offer", userId: coach.id, dataContains: { session_id: session.sessionId } },
      1
    );
  });

  it("gives the session to the first claimer and refuses the second", async () => {
    const db = admin();
    const first = await availableCoach();
    const second = await availableCoach();
    const session = await uncoveredSession();
    await db.rpc("offer_cover_session", { p_session: session.sessionId });

    const firstDb = await asUser(first.email);
    const { error: e1 } = await firstDb.rpc("claim_cover_session", {
      p_session: session.sessionId,
    });
    expect(e1).toBeNull();

    const secondDb = await asUser(second.email);
    const { error: e2 } = await secondDb.rpc("claim_cover_session", {
      p_session: session.sessionId,
    });
    expect(e2).not.toBeNull();
    expect(e2!.message).toContain("already_taken");

    // The winner keeps it — a losing claim must not overwrite the assignment.
    const { data: row } = await db
      .from("class_sessions")
      .select("coach_id, coach_confirmed_at")
      .eq("id", session.sessionId)
      .single();
    expect(row!.coach_id).toBe(first.id);
    // Claiming is confirming: don't nag someone who just volunteered.
    expect(row!.coach_confirmed_at).not.toBeNull();
  });

  it("retires the outstanding offers once it's claimed", async () => {
    const db = admin();
    const claimer = await availableCoach();
    const session = await uncoveredSession();
    await db.rpc("offer_cover_session", { p_session: session.sessionId });

    const claimerDb = await asUser(claimer.email);
    await claimerDb.rpc("claim_cover_session", { p_session: session.sessionId });

    const { data: open } = await db
      .from("notifications")
      .select("id")
      .eq("type", "cover_offer")
      .eq("data->>session_id", session.sessionId)
      .is("read_at", null);
    expect(open ?? []).toHaveLength(0);
  });

  it("tells the founder the outcome, and the booked family the new coach", async () => {
    const db = admin();
    const claimer = await availableCoach();
    const parent = await createClient({ children: 1 });
    const session = await uncoveredSession();
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });
    await db.rpc("offer_cover_session", { p_session: session.sessionId });

    const claimerDb = await asUser(claimer.email);
    const { error } = await claimerDb.rpc("claim_cover_session", { p_session: session.sessionId });
    expect(error).toBeNull();

    // The founder hears an outcome, not a task.
    await expectNotification(db, {
      userId: SEED.founder,
      type: "ops_cover_claimed",
      dataContains: { session_id: session.sessionId },
    });
    await expectNotification(db, { userId: parent.id, type: "coach_changed" });
  });

  it("won't offer a session that already has a coach", async () => {
    const db = admin();
    const coach = await availableCoach();
    const session = await createGroupSession({ startsAt: hoursFromNow(24), coachId: coach.id });

    const { data } = await db.rpc("offer_cover_session", { p_session: session.sessionId });
    expect(Number(data)).toBe(0);
  });
});
