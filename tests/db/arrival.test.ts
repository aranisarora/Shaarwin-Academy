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

  // Migration 0071. Before it, the late branch sent those two notifications and
  // wrote NOTHING to the session — so every other surface still saw a coach who
  // had said nothing, and the start+10 founder escalation told the founder this
  // coach "never responded at all today" minutes after telling them he was
  // running late.
  it("records running late ON THE SESSION, so nothing downstream calls the coach silent", async () => {
    const db = admin();
    const { coach, session } = await seatedSession();

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      late: true,
    });

    const { data: row } = await db
      .from("class_sessions")
      .select("coach_late_at, coach_confirmed_at, coach_arrived_at")
      .eq("id", session.sessionId)
      .single();

    expect(row!.coach_late_at).not.toBeNull();
    // Late implies coming: this is what stops the T-30 nudge and the T-10
    // "hasn't confirmed" escalation chasing someone who has already answered.
    expect(row!.coach_confirmed_at).not.toBeNull();
    // But they are NOT there yet — the start+10 escalation must still be able
    // to fire if they never turn up. It just has to say something true.
    expect(row!.coach_arrived_at).toBeNull();
  });

  it("keeps both timestamps when a late coach then arrives", async () => {
    const db = admin();
    const { coach, session } = await seatedSession();

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      late: true,
    });
    const { data: afterLate } = await db
      .from("class_sessions")
      .select("coach_late_at")
      .eq("id", session.sessionId)
      .single();

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      source: "wa",
    });

    const { data: row } = await db
      .from("class_sessions")
      .select("coach_late_at, coach_arrived_at, coach_arrival_source")
      .eq("id", session.sessionId)
      .single();

    // Arriving late is a real outcome, not a correction — the report of
    // lateness stays true and stays put.
    expect(row!.coach_late_at).toBe(afterLate!.coach_late_at);
    expect(row!.coach_arrived_at).not.toBeNull();
    expect(row!.coach_arrival_source).toBe("wa");
  });

  it("does not retract a reported lateness when the arrival is undone", async () => {
    const db = admin();
    const { coach, session } = await seatedSession();

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      late: true,
    });
    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      source: "tap",
    });
    await coachUndoArrival({ coachEmail: coach.email, sessionId: session.sessionId });

    const { data: row } = await db
      .from("class_sessions")
      .select("coach_late_at, coach_arrived_at")
      .eq("id", session.sessionId)
      .single();

    // Undo means "I'm not there yet after all". It does not mean "I was never
    // running late".
    expect(row!.coach_late_at).not.toBeNull();
    expect(row!.coach_arrived_at).toBeNull();
  });

  it("stamps late only once, so a second report keeps the first time", async () => {
    const db = admin();
    const { coach, session } = await seatedSession();

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      late: true,
    });
    const { data: first } = await db
      .from("class_sessions")
      .select("coach_late_at")
      .eq("id", session.sessionId)
      .single();

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      late: true,
    });
    const { data: second } = await db
      .from("class_sessions")
      .select("coach_late_at")
      .eq("id", session.sessionId)
      .single();

    // The founder's escalation quotes this time back at them, so it has to be
    // when the coach FIRST said it, not when they last repeated it.
    expect(second!.coach_late_at).toBe(first!.coach_late_at);
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
