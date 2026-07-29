// notification-fix-plan Phase 3 item 1 — C11 / M1, session outcome to the
// parent.
//
// The gap this closes was live during the audit: a parent asked the bot "Where
// is he?" about their child mid-day and the bot had nothing to answer with,
// because no message of this kind existed. A child marked no-show produced an
// /admin feed row and total silence to the family.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  createClient,
  createCoach,
  createGroupSession,
  bookSession,
  hoursFromNow,
} from "../../e2e/lib/scenario";
import { expectNotification, expectNoNotification } from "../../e2e/lib/notifications";

/**
 * Build a booked session, then pull it into the past so attendance can be
 * marked on it — bookings can only be made for future sessions.
 */
async function attendedSession() {
  const db = admin();
  const coach = await createCoach();
  const parent = await createClient({ children: 1 });
  const session = await createGroupSession({ startsAt: hoursFromNow(3), coachId: coach.id });
  const booking = await bookSession({
    email: parent.email,
    sessionId: session.sessionId,
    playerId: parent.playerIds[0],
  });

  const started = new Date(Date.now() - 60 * 60_000);
  await db
    .from("class_sessions")
    .update({
      starts_at: started.toISOString(),
      ends_at: new Date(started.getTime() + 60 * 60_000).toISOString(),
    })
    .eq("id", session.sessionId);

  return { coach, parent, session, booking };
}

/** Mark attendance AS THE COACH, so the trigger sees a real auth.uid(). */
async function mark(coachEmail: string, bookingId: string, status: "attended" | "no_show") {
  const coachDb = await asUser(coachEmail);
  const { error } = await coachDb.from("bookings").update({ status }).eq("id", bookingId);
  if (error) throw new Error(`mark(${status}): ${error.message}`);
}

describe("session outcome to the parent (C11 / M1)", () => {
  it("tells the parent when their child did NOT turn up", async () => {
    const db = admin();
    const { coach, parent, session, booking } = await attendedSession();

    await mark(coach.email, booking.id, "no_show");

    const row = await expectNotification(db, {
      userId: parent.id,
      type: "player_absent",
      dataContains: { session_id: session.sessionId },
    });

    // The copy must open a reply channel, not accuse — the marking may be wrong
    // and the parent may know something we don't.
    expect(row.body).toContain("absent");
    expect(row.body).toContain("reply");
    expect(row.data.player_name).toBeTruthy();
    expect(row.data.class_title).toBeTruthy();
    expect(row.data.time_str).toBeTruthy();

    // Never deferred: it must be due immediately, not held to the morning.
    expect(new Date(row.scheduled_for).getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("tells the parent when their child DID turn up", async () => {
    const db = admin();
    const { coach, parent, session, booking } = await attendedSession();

    await mark(coach.email, booking.id, "attended");

    const row = await expectNotification(db, {
      userId: parent.id,
      type: "session_outcome",
      dataContains: { session_id: session.sessionId },
    });
    expect(row.body).toContain("attended");
    expect(row.data.player_name).toBeTruthy();

    // And the absence message must NOT also fire — one message per outcome.
    await expectNoNotification(db, { userId: parent.id, type: "player_absent" });
  });

  it("carries the coach's note as 'what was worked on' when there is one", async () => {
    const db = admin();
    const { coach, parent, session, booking } = await attendedSession();

    await db.from("student_notes").insert({
      player_id: parent.playerIds[0],
      author_id: coach.id,
      body: "Great backhand progress today.",
    });

    await mark(coach.email, booking.id, "attended");

    const row = await expectNotification(db, {
      userId: parent.id,
      type: "session_outcome",
      dataContains: { session_id: session.sessionId },
    });
    expect(row.data.coach_note).toContain("backhand");
    expect(row.body).toContain("backhand");
  });

  it("still records the founder's feed entry either way", async () => {
    const db = admin();
    const { coach, booking } = await attendedSession();
    await mark(coach.email, booking.id, "no_show");

    // The pre-existing behaviour must be untouched — this adds a message, it
    // doesn't replace one.
    await expectNotification(db, {
      userId: "00000000-0000-4000-8000-000000000001",
      type: "ops_attendance",
      dataContains: { booking_id: booking.id },
    });
  });

  it("stays silent when attendance is auto-marked with no acting user", async () => {
    // An automated guess isn't a good enough basis for telling a parent their
    // child went missing. Deliberately preserved from the original trigger.
    const db = admin();
    const { parent, booking } = await attendedSession();

    await db.from("bookings").update({ status: "no_show" }).eq("id", booking.id);

    await expectNoNotification(db, { userId: parent.id, type: "player_absent" });
  });
});
