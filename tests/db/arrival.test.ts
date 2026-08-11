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
  expectNotificationCount,
} from "../../e2e/lib/notifications";

describe("arrival flow (migration 0039)", () => {
  // Ninety minutes out, not three hours — the only window that satisfies both
  // ends of this test. Migration 0079 accepts an arrival within ±2h of the
  // start (production had one stamped 154 minutes after a session began, and
  // another stamped on a cancelled one — a push banner outlives the class it
  // describes), while book_session refuses anything inside
  // booking_cutoff_minutes, which is 60. So: later than now+60min, sooner than
  // now+2h. A test that marked arrival three hours early was exercising
  // something the system should never have allowed.
  async function seatedSession(startsAt = hoursFromNow(1.5)) {
    const coach = await createCoach();
    const parent = await createClient({ children: 1 });
    const session = await createGroupSession({
      startsAt,
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

  // ── Migration 0079 ────────────────────────────────────────────────────────
  // The timestamp was idempotent; the notification INSERT under it was not, so
  // a second "I've arrived" wrote a second message to every booked parent while
  // correctly leaving the timestamp alone. Five families received the same
  // "Coach has arrived" twice before this was found.
  //
  // The trigger is not a fumbled double-tap. The geofenced auto-arrival fires
  // from a GPS callback while the manual button is still on screen, and the
  // auto branch defers its parent ping by two minutes so Undo can beat it — so
  // the pair ALWAYS lands in different delivery batches, which is exactly where
  // the notify worker's per-batch dedupe cannot see it. Push adds a third way
  // to answer the same question, on every device at once.

  it("tells the parents once, however many times the coach says they arrived", async () => {
    const db = admin();
    const { coach, parent, session } = await seatedSession();

    // The real race: auto (deferred 2 min) and a tap (immediate), as the coach
    // screen fires them.
    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      source: "auto",
      distanceM: 42,
    });
    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      source: "tap",
    });
    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      source: "wa",
    });

    await expectNotificationCount(
      db,
      { userId: parent.id, type: "coach_arrived", dataContains: { session_id: session.sessionId } },
      1
    );

    // First writer wins the whole row, not just the clock.
    const { data: row } = await db
      .from("class_sessions")
      .select("coach_arrival_source, coach_arrival_distance_m")
      .eq("id", session.sessionId)
      .single();
    expect(row!.coach_arrival_source).toBe("auto");
    expect(row!.coach_arrival_distance_m).toBe(42);
  });

  it("tells the parents and founders once, however many times the coach reports lateness", async () => {
    const db = admin();
    const { coach, parent, session } = await seatedSession();

    await coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, late: true });
    await coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, late: true });

    await expectNotificationCount(
      db,
      { userId: parent.id, type: "coach_late", dataContains: { session_id: session.sessionId } },
      1
    );
    await expectNotificationCount(
      db,
      { userId: SEED.founder, type: "coach_late", dataContains: { session_id: session.sessionId } },
      1
    );
  });

  it("still notifies when an undo is followed by a real arrival", async () => {
    const db = admin();
    const { coach, parent, session } = await seatedSession();

    await coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, source: "tap" });
    await coachUndoArrival({ coachEmail: coach.email, sessionId: session.sessionId });
    await coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, source: "tap" });

    // Undo clears the stamp, so the next arrival is a genuine transition and
    // has to reach the parents — "notify once" must not become "notify never".
    await expectNotification(db, {
      userId: parent.id,
      type: "coach_arrived",
      dataContains: { session_id: session.sessionId },
    });
  });

  it("refuses an arrival on a cancelled session", async () => {
    const db = admin();
    const { coach, parent, session } = await seatedSession();
    await db.from("class_sessions").update({ status: "cancelled" }).eq("id", session.sessionId);

    await expect(
      coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, source: "tap" })
    ).rejects.toThrow(/session_cancelled/);

    await expectNoNotification(db, { userId: parent.id, type: "coach_arrived" });
  });

  it("refuses an arrival hours after the session, which is what a stale push tap is", async () => {
    const db = admin();
    const { coach, parent, session } = await seatedSession();

    // Book it first, then move it into the past — book_session won't touch a
    // session inside the cutoff, and this test is about the arrival guard, not
    // the booking one. Three hours ago: the class is long over, but its push
    // banner is still sitting in the tray waiting to be tapped.
    await db
      .from("class_sessions")
      .update({
        starts_at: hoursFromNow(-3).toISOString(),
        ends_at: hoursFromNow(-2).toISOString(),
      })
      .eq("id", session.sessionId);

    await expect(
      coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, source: "tap" })
    ).rejects.toThrow(/outside_arrival_window/);

    await expectNoNotification(db, { userId: parent.id, type: "coach_arrived" });
  });

  it("stands the founders down when the arrival lands after they were told to chase", async () => {
    const db = admin();
    const { coach, session } = await seatedSession();

    // The escalation the notify worker fires at start+10.
    await db.from("notifications").insert({
      user_id: SEED.founder,
      type: "ops_coach_not_arrived",
      title: "Coach not marked arrived",
      body: "…hasn't marked arrival 10+ minutes in — call them now.",
      data: { session_id: session.sessionId, url: "/admin/schedule" },
    });

    await coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, source: "wa" });

    // Ramesh Simpi, 10 Aug: founders were told at 06:30:03 to call him and his
    // arrival landed at 06:32:13. Nothing withdrew the instruction, so he was
    // chased for a class he had just reported arriving at.
    const standDown = await expectNotification(db, {
      userId: SEED.founder,
      type: "ops_coach_arrived_late",
      dataContains: { session_id: session.sessionId },
    });
    expect(String(standDown.body)).toContain("no need to chase");
  });

  it("does not stand down a founder who was never alerted", async () => {
    const db = admin();
    const { coach, session } = await seatedSession();

    await coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, source: "tap" });

    // No escalation went out, so there is nothing to withdraw — and a "no need
    // to chase" for a chase that never happened is just another interruption.
    // Scoped to THIS session: the suite shares one database with no per-test
    // reset, so an unscoped assertion would catch the row the previous test
    // legitimately created.
    await expectNoNotification(db, {
      userId: SEED.founder,
      type: "ops_coach_arrived_late",
      dataContains: { session_id: session.sessionId },
    });
  });

  it("stands the founders down when the T-10 warning was the only alert they got", async () => {
    const db = admin();
    const { coach, session } = await seatedSession();

    // Book first, then move the class into the past — book_session refuses
    // anything inside the 60-minute cutoff, and this case only exists once the
    // class is 10+ minutes old. Same manoeuvre as the stale-tap test above.
    await db
      .from("class_sessions")
      .update({
        starts_at: hoursFromNow(-0.5).toISOString(),
        ends_at: hoursFromNow(0.5).toISOString(),
      })
      .eq("id", session.sessionId);

    // ONE row, and it is the T-10 warning rather than the start+10 escalation.
    // That combination is the whole point of 0082: the notify worker now drops
    // the second alert when the coach has said nothing between the two, so for
    // a silent no-show this is the only thing the founder was ever sent. Match
    // on ops_coach_not_arrived alone and there is nothing here to withdraw.
    await db.from("notifications").insert({
      user_id: SEED.founder,
      type: "ops_coach_unconfirmed",
      title: "Augustine hasn't confirmed",
      body: "…still hasn't confirmed they're coming… — it starts in ~10 min.",
      data: { session_id: session.sessionId, url: "/admin/schedule" },
    });

    await coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, source: "tap" });

    const standDown = await expectNotification(db, {
      userId: SEED.founder,
      type: "ops_coach_arrived_late",
      dataContains: { session_id: session.sessionId },
    });
    expect(String(standDown.body)).toContain("no need to chase");
    // And it opens the session, not the week it sits in (0082).
    expect(String(standDown.data.url)).toContain(`session=${session.sessionId}`);
  });

  it("does not stand down a warning about a coach who then turns up on time", async () => {
    const db = admin();
    const { coach, session } = await seatedSession();

    // The class has not started, so this arrival is exactly the case the
    // 10-minute bound exists for. ops_coach_unconfirmed sent 705 times in 30
    // days and most of those coaches simply never tap confirm and then walk in;
    // standing every one of them down would answer a complaint about two
    // notifications with several hundred more.
    await db.from("notifications").insert({
      user_id: SEED.founder,
      type: "ops_coach_unconfirmed",
      title: "Augustine hasn't confirmed",
      body: "…still hasn't confirmed they're coming… — it starts in ~10 min.",
      data: { session_id: session.sessionId, url: "/admin/schedule" },
    });

    await coachMarkArrival({ coachEmail: coach.email, sessionId: session.sessionId, source: "tap" });

    await expectNoNotification(db, {
      userId: SEED.founder,
      type: "ops_coach_arrived_late",
      dataContains: { session_id: session.sessionId },
    });
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
