import { test, expect } from "./fixtures";
import { createClient, createGroupSession, SEED, minutesFromNow } from "../lib/scenario";
import { expectNotification } from "../lib/notifications";

// A real journey: the coach opens today's session and taps the arrival stepper;
// a parent arrival ping must land in the queue. Depth (undo, lateness, founder
// rules) is covered in Layer 1 — this only proves the screen is wired to the RPC.

test("coach taps “I've arrived” on their session → booked parent is pinged", async ({
  coachPage,
  admin,
}) => {
  // Starts in 30 min so the arrival step is unlocked (it opens 1h before start),
  // and assigned to the seeded coach the fixture is logged in as.
  const session = await createGroupSession({
    coachId: SEED.coachSamir,
    startsAt: minutesFromNow(30),
  });
  const parent = await createClient({ children: 1 });

  // Seed a confirmed booking directly: the <1h session would fail the booking
  // cutoff, and it's the arrival action — not booking — under test here.
  const { error } = await admin.from("bookings").insert({
    session_id: session.sessionId,
    client_id: parent.id,
    player_id: parent.playerIds[0],
    status: "confirmed",
  });
  expect(error).toBeNull();

  await coachPage.goto(`/coach/session/${session.sessionId}`);
  await coachPage.getByRole("button", { name: /arrived/i }).click();

  // The screen confirms, and the parent's arrival ping is queued.
  await expect(coachPage.getByText(/parents notified/i)).toBeVisible();
  await expectNotification(admin, {
    userId: parent.id,
    type: "coach_arrived",
    dataContains: { session_id: session.sessionId },
  });
});
