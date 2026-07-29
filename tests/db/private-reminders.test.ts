// notification-fix-plan Phase 3 item 2 (C4) — the 3-hour reminder on
// academy-booked privates.
//
// The plan asked us to confirm the confirmation path fires "for group
// bookings". Production says group is fine (2 of 2 recent group bookings got a
// confirmation) — the hole is elsewhere. This academy is ~96% private sessions
// (52 private vs 2 group over three weeks), almost all booked from /admin, and
// that admin path queued no reminder_upcoming at all. request_private_class
// (the client-initiated path) always did, which is why the gap was invisible
// from the RPC tests.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import { createClient, createCoach } from "../../e2e/lib/scenario";
import { createPrivateSessionCore } from "../../lib/admin-ops-calendar";
import { expectNotification, expectNotificationCount } from "../../e2e/lib/notifications";

const FOUNDER_EMAIL = "founder@sharwin.example";
const FOUNDER_ID = "00000000-0000-4000-8000-000000000001";

function tomorrow(): string {
  return new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
}

async function bookPrivate(recurWeeks?: number) {
  const parent = await createClient({ children: 1 });
  const coach = await createCoach();
  const founder = await asUser(FOUNDER_EMAIL);
  const result = await createPrivateSessionCore(founder, FOUNDER_ID, {
    clientId: parent.id,
    playerId: parent.playerIds[0],
    date: tomorrow(),
    time: "16:00",
    durationMinutes: 60,
    address: "12 Whitefield Court, Whitefield",
    lat: 12.9698,
    lng: 77.75,
    coachId: coach.id,
    overridePlanLimits: true,
    ...(recurWeeks ? { recurWeeks } : {}),
  } as Parameters<typeof createPrivateSessionCore>[2]);
  expect(result.ok).toBe(true);
  return { parent, coach };
}

describe("academy-booked private reminders (C4)", () => {
  it("queues the 3-hour reminder, with what the template needs to render", async () => {
    const db = admin();
    const { parent } = await bookPrivate();

    const row = await expectNotification(db, {
      userId: parent.id,
      type: "reminder_upcoming",
    });

    // The reminder template's variables — without these it renders as
    // "*Later today* / Private session" with no time at all.
    expect(row.data.class_title).toBeTruthy();
    expect(row.data.time_str).toBeTruthy();
    expect(row.data.booking_id).toBeTruthy();
    expect(row.data.session_id).toBeTruthy();
  });

  it("schedules it 3 hours before the session, not immediately", async () => {
    const db = admin();
    const { parent } = await bookPrivate();

    const row = await expectNotification(db, { userId: parent.id, type: "reminder_upcoming" });
    const { data: session } = await db
      .from("class_sessions")
      .select("starts_at")
      .eq("id", String(row.data.session_id))
      .single();

    const gapMs =
      new Date(session!.starts_at).getTime() - new Date(row.scheduled_for).getTime();
    expect(Math.round(gapMs / 60_000)).toBe(180);
  });

  it("gives a recurring private one reminder per occurrence", async () => {
    // Reminders are per-session by design — unlike the booking message, which
    // is collapsed to one. Each occurrence is a real session at its own time.
    const db = admin();
    const { parent } = await bookPrivate(4);
    await expectNotificationCount(db, { userId: parent.id, type: "reminder_upcoming" }, 4);
  });
});
