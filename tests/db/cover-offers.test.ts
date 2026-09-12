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
 * A coach who is actually eligible for anything. Since 0075 dropped weekly
 * availability windows, `active` plus a clear diary is the whole of it — the
 * remaining hard filters are `inactive`, `overlap` and `level_too_high`. Kept
 * as a named helper so the cover tests still read as "an eligible coach".
 */
async function availableCoach() {
  return createCoach();
}

/**
 * Run `fn` with every coach but `keep` paused.
 *
 * offer_cover_session walks `rank_coaches(...) limit 10`. While weekly
 * availability windows existed they pre-narrowed that pool, so a freshly made
 * coach reliably surfaced; since 0075 dropped them every active coach in the
 * shared local DB competes on score alone, and a test coach with no continuity
 * sinks below the cut once earlier specs have created a dozen others. Pausing
 * the rest makes "did the offer reach an eligible coach" a question about the
 * offer, not about how many coaches the suite happened to leave behind.
 * Restored in a finally so a failure can't leak into the next file.
 */
async function withOnlyCoach<T>(keep: string, fn: () => Promise<T>): Promise<T> {
  const db = admin();
  const { data: before, error } = await db
    .from("coaches")
    .select("id")
    .eq("active", true)
    .neq("id", keep);
  if (error) throw new Error(`withOnlyCoach: ${error.message}`);
  const paused = (before ?? []).map((c) => c.id as string);
  if (paused.length) await db.from("coaches").update({ active: false }).in("id", paused);
  try {
    return await fn();
  } finally {
    if (paused.length) await db.from("coaches").update({ active: true }).in("id", paused);
  }
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

    const offer = await withOnlyCoach(coach.id, async () => {
      const { data: offered, error } = await db.rpc("offer_cover_session", {
        p_session: session.sessionId,
      });
      expect(error).toBeNull();
      expect(Number(offered)).toBeGreaterThan(0);

      return expectNotification(db, {
        type: "cover_offer",
        userId: coach.id,
        dataContains: { session_id: session.sessionId },
      });
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

    await withOnlyCoach(coach.id, async () => {
      await db.rpc("offer_cover_session", { p_session: session.sessionId });
      const second = await db.rpc("offer_cover_session", { p_session: session.sessionId });
      expect(Number(second.data)).toBe(0);

      await expectNotificationCount(
        db,
        { type: "cover_offer", userId: coach.id, dataContains: { session_id: session.sessionId } },
        1
      );
    });
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
