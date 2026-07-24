import { describe, it, expect } from "vitest";
import { admin } from "../../e2e/lib/supabase";
import {
  createClient,
  createCoach,
  createGroupSession,
  bookSession,
  coachMarkArrival,
  coachUndoArrival,
  SEED,
  hoursFromNow,
} from "../../e2e/lib/scenario";
import {
  expectNotification,
  expectNoNotification,
} from "../../e2e/lib/notifications";

describe("arrival flow (migration 0039)", () => {
  async function seatedSession() {
    const coach = await createCoach();
    const parent = await createClient({ children: 1 });
    const session = await createGroupSession({
      startsAt: hoursFromNow(3),
      coachId: coach.id,
    });
    const booking = await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });
    return { coach, parent, session, booking };
  }

  it("pings the booked parent on a normal (on-time) arrival — and does NOT ping founders", async () => {
    const db = admin();
    const { coach, parent, session } = await seatedSession();

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      source: "tap",
    });

    // Parent gets the arrival ping, carrying render data for the WhatsApp.
    const ping = await expectNotification(db, {
      userId: parent.id,
      type: "coach_arrived",
      dataContains: { session_id: session.sessionId },
    });
    expect(ping.data.coach_name).toBeTruthy();
    expect(ping.data.location_str).toBeTruthy();

    // On-time arrivals don't bother founders (only lateness does).
    await expectNoNotification(db, { userId: SEED.founder, type: "coach_arrived" });

    // Arrived implies coming: the session is also stamped confirmed.
    const { data: row } = await db
      .from("class_sessions")
      .select("coach_arrived_at, coach_confirmed_at")
      .eq("id", session.sessionId)
      .single();
    expect(row!.coach_arrived_at).not.toBeNull();
    expect(row!.coach_confirmed_at).not.toBeNull();
  });

  it("pings both parent and founders when the coach is running late", async () => {
    const db = admin();
    const { coach, parent, session } = await seatedSession();

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      late: true,
    });

    await expectNotification(db, { userId: parent.id, type: "coach_late" });
    await expectNotification(db, { userId: SEED.founder, type: "coach_late" });
  });

  it("undo removes the still-pending parent arrival ping", async () => {
    const db = admin();
    const { coach, parent, session } = await seatedSession();

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      source: "tap",
    });
    await expectNotification(db, { userId: parent.id, type: "coach_arrived" });

    await coachUndoArrival({ coachEmail: coach.email, sessionId: session.sessionId });

    // Pending ping is pulled; the arrival stamp is cleared (but confirm stays).
    await expectNoNotification(db, {
      userId: parent.id,
      type: "coach_arrived",
      status: "pending",
    });
    const { data: row } = await db
      .from("class_sessions")
      .select("coach_arrived_at, coach_confirmed_at")
      .eq("id", session.sessionId)
      .single();
    expect(row!.coach_arrived_at).toBeNull();
    expect(row!.coach_confirmed_at).not.toBeNull();
  });
});
