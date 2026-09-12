// Migration 0048 — the notification types that were wired into the preferences
// UI with nothing behind them.
//
// Six types appear in `PREF_GROUP_FOR_TYPE` (supabase/functions/notify/index.ts)
// and therefore in the profile and onboarding preference screens, but nothing in
// the codebase ever inserted them. Members could toggle switches that controlled
// messages the academy had never once sent. Two whole categories were near
// hollow: "Progress" promised monthly summaries, assessments and coach notes and
// only `session_outcome` was live; "News & offers" promised new classes and
// renewal notices and only the manual broadcast was.
//
// This covers the four that are event-driven and therefore testable at Layer 1.
// The two time-driven ones (`renewal_upcoming`, `monthly_progress`) are sweeps
// in the notify worker, alongside the two morning briefings, and have no DB
// trigger to assert against here.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  createClient,
  createCoach,
  createGroupSession,
  bookSession,
  hoursFromNow,
  SEED,
} from "../../e2e/lib/scenario";
import { expectNotification, expectNoNotification } from "../../e2e/lib/notifications";

describe("payment_receipt — money in the good direction", () => {
  it("sends the client a receipt for a one-off purchase", async () => {
    const db = admin();
    const parent = await createClient({ children: 1 });

    const { error } = await db.from("orders").insert({
      client_id: parent.id,
      player_id: parent.playerIds[0],
      product_id: "private-60",
      amount_pence: 119900,
      status: "paid",
      paid_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    const row = await expectNotification(db, { userId: parent.id, type: "payment_receipt" });
    expect(row.body).toContain("₹1199"); // fmt_inr renders paise→rupees, no separator
    expect(row.data.url).toBe("/app/billing");

    // The founder's existing feed row must be untouched — this adds a message,
    // it doesn't replace one.
    await expectNotification(db, { userId: SEED.founder, type: "ops_payment" });
  });

  it("names the plan on a subscription renewal invoice", async () => {
    const db = admin();
    const parent = await createClient({ children: 1 });

    const { data: sub } = await db
      .from("subscriptions")
      .insert({
        client_id: parent.id,
        plan_id: SEED.groupPlan1x,
        status: "active",
        current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      })
      .select("id")
      .single();

    await db.from("invoices").insert({
      client_id: parent.id,
      subscription_id: sub!.id,
      amount_pence: 450000,
      status: "paid",
      paid_at: new Date().toISOString(),
    });

    const row = await expectNotification(db, { userId: parent.id, type: "payment_receipt" });
    expect(row.data.plan_name).toBeTruthy();
    expect(row.body).toContain("covered through");
  });

  it("stays silent on an unpaid invoice", async () => {
    const db = admin();
    const parent = await createClient({ children: 1 });
    await db.from("invoices").insert({
      client_id: parent.id,
      amount_pence: 450000,
      status: "open",
    });
    await expectNoNotification(db, { userId: parent.id, type: "payment_receipt" });
  });
});

describe("new_class_open — telling families a class exists", () => {
  /** A group class at `level`, which is what the trigger fans out on. */
  async function openClass(over: Record<string, unknown> = {}) {
    const db = admin();
    // `classes` carries a group_needs_venue check — a group class must sit
    // somewhere. Any seeded venue will do.
    const { data: venue } = await db.from("venues").select("id").limit(1).single();
    const { data, error } = await db
      .from("classes")
      .insert({
        class_type: "group",
        title: `Test Batch ${Math.floor(Date.now() % 1e6)}`,
        skill_level: "beginner",
        capacity: 8,
        duration_minutes: 60,
        starts_on: new Date().toISOString().slice(0, 10),
        venue_id: venue!.id,
        active: true,
        ...over,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id as string;
  }

  it("tells a client with a player at that level", async () => {
    const db = admin();
    const parent = await createClient({ children: 1 }); // players default to beginner
    const classId = await openClass();

    const row = await expectNotification(db, {
      userId: parent.id,
      type: "new_class_open",
      dataContains: { class_id: classId },
    });
    expect(row.body).toContain("new");
    expect(row.data.url).toBe("/app/book");
  });

  it("never fans out for a school class", async () => {
    // School players have no account and their parents did not sign up to be a
    // marketing list.
    const db = admin();
    const parent = await createClient({ children: 1 });
    const classId = await openClass({ is_school: true });

    await expectNoNotification(db, {
      userId: parent.id,
      type: "new_class_open",
      dataContains: { class_id: classId },
    });
  });

  it("never fans out for a private class", async () => {
    // A private is arranged, not offered.
    const db = admin();
    const parent = await createClient({ children: 1 });
    const classId = await openClass({ class_type: "private", capacity: 1 });

    await expectNoNotification(db, {
      userId: parent.id,
      type: "new_class_open",
      dataContains: { class_id: classId },
    });
  });

  it("never fans out for an inactive class", async () => {
    const db = admin();
    const parent = await createClient({ children: 1 });
    const classId = await openClass({ active: false });

    await expectNoNotification(db, {
      userId: parent.id,
      type: "new_class_open",
      dataContains: { class_id: classId },
    });
  });
});

describe("assessment_ready — the write-only progress system", () => {
  it("tells the parent an assessment was filed", async () => {
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1 });

    await db
      .from("skill_assessments")
      .insert({ player_id: parent.playerIds[0], coach_id: coach.id });

    const row = await expectNotification(db, {
      userId: parent.id,
      type: "assessment_ready",
      dataContains: { player_id: parent.playerIds[0] },
    });
    expect(row.data.player_name).toBeTruthy();
    expect(row.data.url).toBe("/app/players");
  });

  it("throttles to one per player per week", async () => {
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1 });

    for (let i = 0; i < 3; i++) {
      await db
        .from("skill_assessments")
        .insert({ player_id: parent.playerIds[0], coach_id: coach.id });
    }

    const { data } = await db
      .from("notifications")
      .select("id")
      .eq("user_id", parent.id)
      .eq("type", "assessment_ready");
    expect(data?.length).toBe(1);
  });
});

describe("student_note — surfacing a coach's note", () => {
  it("tells the parent about a note written outside the attendance flow", async () => {
    const db = admin();
    const coach = await createCoach();
    const parent = await createClient({ children: 1 });

    await db.from("student_notes").insert({
      player_id: parent.playerIds[0],
      author_id: coach.id,
      body: "Much more confident on the backhand return.",
    });

    const row = await expectNotification(db, {
      userId: parent.id,
      type: "student_note",
      dataContains: { player_id: parent.playerIds[0] },
    });
    expect(row.body).toContain("backhand");
  });

  it("does NOT double up when session_outcome already quoted the note", async () => {
    // session_outcome (migration 0046) already carries the coach's note when it
    // finds one written after the session started. Firing this as well would
    // send a parent the same sentence twice.
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

    // Mark attended as the coach → session_outcome fires.
    const coachDb = await asUser(coach.email);
    await coachDb.from("bookings").update({ status: "attended" }).eq("id", booking.id);
    await expectNotification(db, { userId: parent.id, type: "session_outcome" });

    // A note written now is already covered by that message.
    await db.from("student_notes").insert({
      player_id: parent.playerIds[0],
      author_id: coach.id,
      body: "Worked on service return.",
    });

    await expectNoNotification(db, { userId: parent.id, type: "student_note" });
  });

  it("ignores a note the parent wrote themselves", async () => {
    const db = admin();
    const parent = await createClient({ children: 1 });
    await db.from("student_notes").insert({
      player_id: parent.playerIds[0],
      author_id: parent.id,
      body: "Remember to pack the good bat.",
    });
    await expectNoNotification(db, { userId: parent.id, type: "student_note" });
  });
});
