// Ending a weekly private slot from the admin — the half of the Weekly classes
// tab that had no removal path at all.
//
// A `private_booking_series` row is a standing arrangement with a paying family
// behind it, and three things about it make the ordinary "cancel the sessions"
// approach wrong:
//
//  1. IT REGENERATES. `generate_private_sessions` loops over `where active`
//     under a nightly cron, and its guard only blocks a week that already has a
//     booking row. Cancel the weeks without retiring the template and they are
//     back the next night — and because the refund restores the balance, the
//     minutes check passes and the family is debited all over again. That is why
//     every test here asserts against the generator, not just against the rows.
//  2. IT COSTS MONEY. Minutes have to come back, in full — including the week
//     inside the 24-hour window that a family cancelling late would forfeit. The
//     academy ending its own slot has not cost the coach an evening.
//  3. IT IS NOT THE FAMILY'S DOING. `cancel_private_series` (the client's
//     function) writes 'cancelled_by_client' and messages only the coach, once
//     per week, saying the client cancelled. Used by the founder that is three
//     lies and a notification burst: 'cancelled_by_client' is in
//     ops_notify_booking_status's list where 'cancelled_by_academy' deliberately
//     is not, and both that type and session_cancelled are TRANSACTIONAL — no
//     prefs, no quiet hours, no daily cap.

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  countFutureSeriesSessions,
  createCoach,
  createPrivateSeries,
  SEED,
} from "../../e2e/lib/scenario";
import { expectNotificationCount } from "../../e2e/lib/notifications";
import {
  endPrivateSeriesCore,
  planPrivateSeriesRemovalCore,
} from "../../lib/admin-ops-private-series";

const FOUNDER_EMAIL = "founder@sharwin.example";
const typed = (c: SupabaseClient) => c as unknown as SupabaseClient<Database>;

/** Net minutes on a client's ledger — the only honest measure of "refunded". */
async function balance(clientId: string): Promise<number> {
  const { data, error } = await admin()
    .from("private_credit_ledger")
    .select("delta_minutes")
    .eq("client_id", clientId);
  if (error) throw new Error(`balance: ${error.message}`);
  return (data ?? []).reduce((n, r) => n + (r.delta_minutes as number), 0);
}

describe("weekly private slot removal", () => {
  it("retires the slot so the nightly generator does not bring it back", async () => {
    const coach = await createCoach();
    const s = await createPrivateSeries({ weekday: 3, startTime: "17:00", coachId: coach.id });

    // The control. Without this the test would pass just as happily against a
    // fixture that never generated anything in the first place.
    const before = await countFutureSeriesSessions(s.seriesId);
    expect(before).toBeGreaterThan(0);

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await endPrivateSeriesCore(typed(founder), SEED.founder, [s.seriesId]);
    expect(r.ok).toBe(true);
    expect(r.ended).toBe(1);

    const { data: row } = await admin()
      .from("private_booking_series")
      .select("active,cancelled_at")
      .eq("id", s.seriesId)
      .single();
    expect(row!.active).toBe(false);
    expect(row!.cancelled_at).not.toBeNull();

    // The whole point: run the generator again and nothing comes back.
    await admin().rpc("generate_private_sessions", { p_weeks: 8 });
    expect(await countFutureSeriesSessions(s.seriesId)).toBe(0);
  });

  it("gives back every cancelled week's minutes in full", async () => {
    const coach = await createCoach();
    const s = await createPrivateSeries({ weekday: 4, startTime: "17:30", coachId: coach.id });
    const granted = s.durationMinutes * 8;

    // Each generated week debits the ledger, so the balance is below the grant.
    const spent = await balance(s.clientId);
    expect(spent).toBeLessThan(granted);
    const weeks = await countFutureSeriesSessions(s.seriesId);
    expect(weeks).toBeGreaterThan(0);

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await endPrivateSeriesCore(typed(founder), SEED.founder, [s.seriesId]);
    expect(r.ok).toBe(true);
    expect(r.minutesReturned).toBe(weeks * s.durationMinutes);

    // Back exactly where the family started — no week withheld for being close.
    expect(await balance(s.clientId)).toBe(spent + weeks * s.durationMinutes);
  });

  it("records the cancellation as the academy's, not the family's", async () => {
    const coach = await createCoach();
    const s = await createPrivateSeries({ weekday: 5, startTime: "18:00", coachId: coach.id });

    const founder = await asUser(FOUNDER_EMAIL);
    await endPrivateSeriesCore(typed(founder), SEED.founder, [s.seriesId]);

    const { data: bookings } = await admin()
      .from("bookings")
      .select("status,cancel_reason")
      .eq("private_series_id", s.seriesId);
    expect((bookings ?? []).length).toBeGreaterThan(0);
    for (const b of bookings ?? []) {
      expect(b.status).toBe("cancelled_by_academy");
      expect(b.cancel_reason).toBe("weekly slot ended");
    }

    // 'cancelled_by_academy' is the status ops_notify_booking_status skips. If
    // this ever regresses to a cancel_booking loop, the founder's own phone
    // takes one uncapped, un-deferred push per week per family.
    await expectNotificationCount(
      admin(),
      { userId: s.clientId, type: "ops_cancellation" },
      0
    );
  });

  it("tells the family once and the coach once, not once per week", async () => {
    const coach = await createCoach();
    const s = await createPrivateSeries({ weekday: 2, startTime: "16:00", coachId: coach.id });
    expect(await countFutureSeriesSessions(s.seriesId)).toBeGreaterThan(1);

    const founder = await asUser(FOUNDER_EMAIL);
    await endPrivateSeriesCore(typed(founder), SEED.founder, [s.seriesId]);

    await expectNotificationCount(admin(), { userId: s.clientId, type: "session_cancelled" }, 1);
    await expectNotificationCount(admin(), { userId: coach.id, type: "session_cancelled" }, 1);
  });

  it("clears the reminders queued for hours that no longer exist", async () => {
    const coach = await createCoach();
    const s = await createPrivateSeries({ weekday: 6, startTime: "15:00", coachId: coach.id });

    // Queue a reminder against one of the generated sessions, the way the
    // booking path does.
    const { data: booking } = await admin()
      .from("bookings")
      .select("session_id")
      .eq("private_series_id", s.seriesId)
      .limit(1)
      .single();
    await admin().from("notifications").insert({
      user_id: s.clientId,
      type: "reminder_24h",
      title: "Tomorrow",
      body: "Your private session is tomorrow.",
      data: { session_id: booking!.session_id },
      status: "pending",
    });

    const founder = await asUser(FOUNDER_EMAIL);
    await endPrivateSeriesCore(typed(founder), SEED.founder, [s.seriesId]);

    await expectNotificationCount(
      admin(),
      { userId: s.clientId, type: "reminder_24h", status: "pending" },
      0
    );
  });

  it("leaves the family's other weekly slot alone", async () => {
    const coach = await createCoach();
    const a = await createPrivateSeries({ weekday: 1, startTime: "17:00", coachId: coach.id });
    // A second slot for the SAME family, so this pins the difference between
    // ending one slot and the Schedule tab's client-wide sweep.
    const { data: b, error } = await admin()
      .from("private_booking_series")
      .insert({
        client_id: a.clientId,
        player_id: a.playerId,
        preferred_coach: coach.id,
        weekday: 2,
        start_time: "19:00",
        duration_minutes: 60,
        address: "12 Whitefield Court, Whitefield",
        postcode: "",
        lat: 12.9698,
        lng: 77.75,
        has_table: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(`second series: ${error.message}`);

    const founder = await asUser(FOUNDER_EMAIL);
    await endPrivateSeriesCore(typed(founder), SEED.founder, [a.seriesId]);

    const { data: other } = await admin()
      .from("private_booking_series")
      .select("active")
      .eq("id", b!.id)
      .single();
    expect(other!.active).toBe(true);
  });

  it("prices the removal before it happens, and says what it cannot find", async () => {
    const coach = await createCoach();
    const s = await createPrivateSeries({ weekday: 7, startTime: "11:00", coachId: coach.id });
    const weeks = await countFutureSeriesSessions(s.seriesId);

    const founder = await asUser(FOUNDER_EMAIL);
    const ghost = "00000000-0000-4000-8000-00000000dead";
    const plan = await planPrivateSeriesRemovalCore(typed(founder), [s.seriesId, ghost]);

    expect(plan.endable).toEqual([s.seriesId]);
    expect(plan.missing).toEqual([ghost]);
    expect(plan.cost.futureSessions).toBe(weeks);
    expect(plan.cost.minutesReturned).toBe(weeks * s.durationMinutes);
    expect(plan.cost.families).toBe(1);
    expect(plan.cost.coaches).toBe(1);

    // Read-only: it must not have touched the thing it was pricing.
    const { data: row } = await admin()
      .from("private_booking_series")
      .select("active")
      .eq("id", s.seriesId)
      .single();
    expect(row!.active).toBe(true);
  });

  it("counts an already-retired slot rather than pretending it went", async () => {
    const coach = await createCoach();
    const s = await createPrivateSeries({ weekday: 3, startTime: "20:00", coachId: coach.id });
    const founder = await asUser(FOUNDER_EMAIL);
    await endPrivateSeriesCore(typed(founder), SEED.founder, [s.seriesId]);

    const plan = await planPrivateSeriesRemovalCore(typed(founder), [s.seriesId]);
    expect(plan.endable).toEqual([]);
    expect(plan.alreadyEnded).toEqual([s.seriesId]);
  });
});
