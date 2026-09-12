import { describe, it, expect } from "vitest";
import { admin } from "../../e2e/lib/supabase";
import {
  createClient,
  createGroupSession,
  bookSession,
  cancelBooking,
  hoursFromNow,
} from "../../e2e/lib/scenario";
import {
  expectNotification,
  expectNoNotification,
} from "../../e2e/lib/notifications";

describe("cancellation", () => {
  it("deletes the pending reminder for a cancelled booking and refunds the trial credit", async () => {
    const db = admin();
    // >24h out → in-window (free) cancel.
    const parent = await createClient({ children: 1 });
    const session = await createGroupSession({ startsAt: hoursFromNow(30) });
    const booking = await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });

    // The reminder exists while booked…
    await expectNotification(db, {
      type: "reminder_upcoming",
      dataContains: { booking_id: booking.id },
      status: "pending",
    });

    await cancelBooking({ email: parent.email, bookingId: booking.id });

    // …and is swept once cancelled.
    await expectNoNotification(db, {
      type: "reminder_upcoming",
      dataContains: { booking_id: booking.id },
    });

    // The consumed trial credit is handed back (in-window).
    const { data: credit } = await db
      .from("class_credits")
      .select("consumed_at")
      .eq("client_id", parent.id)
      .eq("type", "group_trial")
      .single();
    expect(credit!.consumed_at).toBeNull();
  });

  it("offers the freed spot to the first waitlisted client", async () => {
    const db = admin();
    const session = await createGroupSession({ startsAt: hoursFromNow(30), capacity: 1 });

    const first = await createClient({ children: 1 });
    const second = await createClient({ children: 1 });

    const confirmed = await bookSession({
      email: first.email,
      sessionId: session.sessionId,
      playerId: first.playerIds[0],
    });
    expect(confirmed.status).toBe("confirmed");

    const waitlisted = await bookSession({
      email: second.email,
      sessionId: session.sessionId,
      playerId: second.playerIds[0],
    });
    expect(waitlisted.status).toBe("waitlisted");

    // Cancelling the confirmed booking offers the spot to the waitlisted parent.
    await cancelBooking({ email: first.email, bookingId: confirmed.id });

    await expectNotification(db, {
      userId: second.id,
      type: "waitlist_spot",
      dataContains: { session_id: session.sessionId },
    });
  });
});
