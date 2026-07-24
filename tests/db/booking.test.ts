import { describe, it, expect } from "vitest";
import { admin } from "../../e2e/lib/supabase";
import {
  createClient,
  createGroupSession,
  bookSession,
  bookSeries,
  pickRecurringGroupSession,
  SEED,
  hoursFromNow,
} from "../../e2e/lib/scenario";
import {
  expectNotification,
  expectNotificationCount,
} from "../../e2e/lib/notifications";

describe("group booking", () => {
  it("queues a confirmation now + one reminder 3h before start, and one founder ops entry", async () => {
    const db = admin();
    const startsAt = hoursFromNow(4);
    const parent = await createClient({ children: 1 }); // gets a trial credit
    const session = await createGroupSession({ startsAt });

    const booking = await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });
    expect(booking.status).toBe("confirmed");

    // Right person, right type, right payload — confirmation is immediate.
    await expectNotification(db, {
      userId: parent.id,
      type: "booking_confirmed",
      dataContains: { session_id: session.sessionId, booking_id: booking.id },
      scheduledFor: { near: new Date(), toleranceMinutes: 2 },
    });

    // Right time — one consolidated reminder ~3h before the session start.
    await expectNotification(db, {
      userId: parent.id,
      type: "reminder_upcoming",
      dataContains: { session_id: session.sessionId },
      scheduledFor: { near: new Date(startsAt.getTime() - 3 * 3600_000), toleranceMinutes: 5 },
    });

    // Founders see exactly one ops-feed entry for the booking.
    await expectNotificationCount(
      db,
      { userId: SEED.founder, type: "ops_booking", dataContains: { booking_id: booking.id } },
      1
    );
  });
});

describe("recurring series booking (0028 spam guard)", () => {
  it("queues ONE client confirmation and ONE founder ops entry, not one per occurrence", async () => {
    const db = admin();
    // A member (group plan) can book a recurring slot; enrol every future
    // occurrence of a seeded weekly batch.
    const parent = await createClient({ children: 1, groupPlanId: SEED.groupPlan2x });

    const slot = await pickRecurringGroupSession(3);

    const result = await bookSeries({
      email: parent.email,
      sessionId: slot.sessionId,
      playerId: parent.playerIds[0],
      recurring: true,
    });

    // Several occurrences enrolled across future weeks…
    expect(result.confirmed).toBeGreaterThan(1);

    // …but the parent is told once, and founders see one ops entry — the whole
    // point of migration 0028.
    await expectNotificationCount(
      db,
      { userId: parent.id, type: "booking_confirmed" },
      1
    );
    await expectNotificationCount(
      db,
      { userId: SEED.founder, type: "ops_booking", dataContains: { client_id: parent.id } },
      1
    );
  });
});
