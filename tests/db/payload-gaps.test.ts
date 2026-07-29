// notification-fix-plan 2.5 — payload assertions (G3, G4, old→new).
//
// A WhatsApp template can only render what `data` carries. These gaps are
// invisible in the app (which reads `body`) and only show up on the member's
// phone, which is exactly why they survived this long. Asserting the payload
// keys is the cheapest way to keep them fixed.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  createClient,
  createCoach,
  createGroupSession,
  bookSession,
  cancelBooking,
  hoursFromNow,
} from "../../e2e/lib/scenario";
import { moveSessionCore } from "../../lib/admin-ops-calendar";
import { expectNotification } from "../../e2e/lib/notifications";

const FOUNDER_EMAIL = "founder@sharwin.example";
const FOUNDER_ID = "00000000-0000-4000-8000-000000000001";

describe("waitlist offer payload (G4)", () => {
  it("names the class and the real claim window", async () => {
    const db = admin();
    const coach = await createCoach();
    const holder = await createClient({ children: 1 });
    const waiter = await createClient({ children: 1 });

    // One seat, taken — the next booking waitlists.
    const session = await createGroupSession({
      startsAt: hoursFromNow(30),
      coachId: coach.id,
      capacity: 1,
    });
    const booking = await bookSession({
      email: holder.email,
      sessionId: session.sessionId,
      playerId: holder.playerIds[0],
    });
    await bookSession({
      email: waiter.email,
      sessionId: session.sessionId,
      playerId: waiter.playerIds[0],
    });

    // Freeing the seat offers it to the waitlisted family.
    await cancelBooking({ email: holder.email, bookingId: booking.id });

    const offer = await expectNotification(db, {
      userId: waiter.id,
      type: "waitlist_spot",
      dataContains: { session_id: session.sessionId },
    });

    // Before 2.5 the template could only say "a spot just opened in a class",
    // with a hardcoded 15 minutes regardless of settings.
    expect(offer.data.class_title).toBeTruthy();
    expect(offer.data.class_title).not.toBe("a class");
    expect(Number(offer.data.claim_minutes)).toBeGreaterThan(0);
    expect(String(offer.data.url)).toContain(session.sessionId);
  });
});

describe("session moved payload (old → new)", () => {
  it("carries what it moved FROM, not just the new time", async () => {
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1 });
    const session = await createGroupSession({
      startsAt: hoursFromNow(48),
      coachId: coach.id,
    });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });

    const target = new Date(Date.now() + 72 * 3600_000);
    const founder = await asUser(FOUNDER_EMAIL);
    const result = await moveSessionCore(
      founder,
      FOUNDER_ID,
      session.sessionId,
      target.toISOString().slice(0, 10),
      "17:00"
    );
    expect(result.ok).toBe(true);

    const moved = await expectNotification(db, {
      userId: parent.id,
      type: "session_moved",
      dataContains: { session_id: session.sessionId },
    });

    expect(moved.data.old_time_str).toBeTruthy();
    expect(moved.data.new_time_str).toBeTruthy();
    expect(moved.data.old_time_str).not.toBe(moved.data.new_time_str);
    expect(moved.data.old_starts_at).toBeTruthy();
    // The member can now tell which of their sessions moved, from the message
    // alone — previously it only said what the new time is.
    expect(moved.body).toContain("moved from");
  });
});
