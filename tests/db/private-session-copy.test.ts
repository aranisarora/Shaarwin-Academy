// notification-fix-plan 2.4 / gap G1 — a client must never receive a
// coach-worded message with a coach deep link.
//
// createPrivateSessionCore queued `new_private_session` for BOTH the client and
// the coach, and interactiveContentFor() maps that type unconditionally to the
// coach template (TWILIO_WA_COACH_PRIVATE_SID) whose CTA points at
// /coach/session/<id>. A parent booking an academy-arranged private therefore
// got coach copy and a link they can't open.
//
// The fix is a distinct client type. These tests pin the type split and the
// recurring-burst collapse that went with it.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import { createClient, createCoach } from "../../e2e/lib/scenario";
import { createPrivateSessionCore } from "../../lib/admin-ops-calendar";
import {
  expectNotification,
  expectNoNotification,
  expectNotificationCount,
} from "../../e2e/lib/notifications";

const FOUNDER_EMAIL = "founder@sharwin.example";
const FOUNDER_ID = "00000000-0000-4000-8000-000000000001";

/** Tomorrow in academy wall-clock, so the session is always in the future. */
function tomorrow(): string {
  return new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
}

async function bookPrivate(opts: { recurWeeks?: number } = {}) {
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
    ...(opts.recurWeeks ? { recurWeeks: opts.recurWeeks } : {}),
  } as Parameters<typeof createPrivateSessionCore>[2]);

  return { parent, coach, result };
}

describe("private session copy (G1)", () => {
  it("gives the client its own type, never the coach's", async () => {
    const db = admin();
    const { parent, result } = await bookPrivate();
    expect(result.ok).toBe(true);

    const row = await expectNotification(db, {
      userId: parent.id,
      type: "private_session_booked",
    });
    // The client's CTA must stay in the client app.
    expect(String(row.data.url)).toBe("/app/schedule");
    expect(String(row.data.url)).not.toContain("/coach/");

    // The coach-worded type must not reach the parent at all — that mapping is
    // what rendered the coach template with an unopenable link.
    await expectNoNotification(db, { userId: parent.id, type: "new_private_session" });
  });

  it("still tells the coach, with a coach link", async () => {
    const db = admin();
    const { coach } = await bookPrivate();

    const row = await expectNotification(db, {
      userId: coach.id,
      type: "new_private_session",
    });
    expect(String(row.data.url)).toContain("/coach/session/");
  });

  it("queues ONE coach message for a recurring private, not one per week", async () => {
    const db = admin();
    const { coach, result } = await bookPrivate({ recurWeeks: 4 });
    expect(result.ok).toBe(true);

    // Before this change a 4-week private queued 4 identical coach messages.
    const rows = await expectNotificationCount(
      db,
      { userId: coach.id, type: "new_private_session" },
      1
    );
    expect(rows[0].data.session_count).toBe(4);
  });
});
