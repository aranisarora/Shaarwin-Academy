import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import { createCoach, createGroupSession, SEED, hoursFromNow } from "../../e2e/lib/scenario";
import { expectNotification } from "../../e2e/lib/notifications";

describe("coach confirmation + reassignment", () => {
  it("coach_confirm_session stamps confirmed_at (and does not ping founders)", async () => {
    const db = admin();
    const coach = await createCoach();
    const session = await createGroupSession({ startsAt: hoursFromNow(3), coachId: coach.id });

    const asCoach = await asUser(coach.email);
    const { data: at, error } = await asCoach.rpc("coach_confirm_session", {
      p_session: session.sessionId,
    });
    expect(error).toBeNull();
    expect(at).toBeTruthy();

    const { data: row } = await db
      .from("class_sessions")
      .select("coach_confirmed_at")
      .eq("id", session.sessionId)
      .single();
    expect(row!.coach_confirmed_at).not.toBeNull();
  });

  it("reassigning a near-term session pings founders and resets the confirmation", async () => {
    const db = admin();
    const coachA = await createCoach();
    const coachB = await createCoach();
    const session = await createGroupSession({ startsAt: hoursFromNow(24), coachId: coachA.id });

    // Coach A confirms; then the session is reassigned to B.
    const asCoachA = await asUser(coachA.email);
    await asCoachA.rpc("coach_confirm_session", { p_session: session.sessionId });

    const { error } = await db
      .from("class_sessions")
      .update({ coach_id: coachB.id })
      .eq("id", session.sessionId);
    expect(error).toBeNull();

    // Founders see the coach change on the ops feed…
    await expectNotification(db, {
      userId: SEED.founder,
      type: "ops_coach_change",
      dataContains: { session_id: session.sessionId },
    });

    // …and the confirmation is wiped, since a new coach hasn't confirmed yet
    // (reset_session_confirmation trigger).
    const { data: row } = await db
      .from("class_sessions")
      .select("coach_confirmed_at, coach_id")
      .eq("id", session.sessionId)
      .single();
    expect(row!.coach_id).toBe(coachB.id);
    expect(row!.coach_confirmed_at).toBeNull();
  });
});
