// Clearing the WHOLE calendar (wipe_calendar).
//
// Every other removal in this app works on a selection, so its blast radius is
// whatever the founder ticked. This one's is everything, which changes what the
// tests have to prove:
//
//  • The guard is real and lives in the DATABASE. Not a checkbox in a sheet —
//    a typed token the RPC itself rejects, and a founder check the RPC itself
//    makes, because SECURITY DEFINER bypasses RLS and a policy could not do it.
//  • It reaches the things a selection cannot: one-off classes (never on the
//    Weekly list), and the `class_type='private'` weeks behind every private
//    slot. If it misses those, "clear my calendar" leaves a calendar.
//  • It does not un-wipe itself overnight. `private_booking_series` has no FK to
//    `classes`, so deleting every class leaves every live series standing and
//    the nightly generator refills the week. Retiring the templates is step one,
//    and the test that matters runs the generator afterwards.
//  • ONE message per person, for the whole calendar. `session_cancelled` is
//    TRANSACTIONAL — no prefs, no quiet hours, no daily cap — so a loop here
//    would be a 2am burst at every family the academy has.
//  • Money comes back. A private week's debit is written with booking_id NULL,
//    so a cascade cannot find it; the compensating row has to be written before
//    the delete or the family is simply out the minutes.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  bookSession,
  countFutureSeriesSessions,
  createClient,
  createCoach,
  createPrivateSeries,
  createWeeklySlot,
  SEED,
} from "../../e2e/lib/scenario";
import { expectNotificationCount } from "../../e2e/lib/notifications";

const FOUNDER_EMAIL = "founder@sharwin.example";
const uniq = () => Math.random().toString(36).slice(2, 7);

async function countClasses(): Promise<number> {
  const { count } = await admin()
    .from("classes")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

async function balance(clientId: string): Promise<number> {
  const { data } = await admin()
    .from("private_credit_ledger")
    .select("delta_minutes")
    .eq("client_id", clientId);
  return (data ?? []).reduce((n, r) => n + (r.delta_minutes as number), 0);
}

/** A group class that runs on a DATE, not a weekday — the kind the Weekly tab
 * deliberately keeps off its list, so a selection can never reach it. */
async function createOneOffClass(label: string): Promise<string> {
  const db = admin();
  const { data: seed } = await db
    .from("classes")
    .select("venue_id,capacity,duration_minutes,skill_level")
    .eq("id", SEED.groupClass)
    .single();
  const { data, error } = await db
    .from("classes")
    .insert({
      class_type: "group",
      title: label,
      skill_level: seed!.skill_level,
      capacity: seed!.capacity,
      duration_minutes: seed!.duration_minutes,
      venue_id: seed!.venue_id,
      recurrence_rule: null, // <- the thing that keeps it off the Weekly tab
      starts_on: new Date().toISOString().slice(0, 10),
      created_by: SEED.founder,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createOneOffClass: ${error?.message}`);
  return data.id as string;
}

/**
 * The one file in this suite that rebuilds the database around every test.
 *
 * The harness deliberately resets ONCE per run (see tests/db/global-setup.ts):
 * factories use unique ids, so suites stay independent without paying for a
 * reset each time. That bargain relies on every test touching only what it
 * created — and this one is the exception by definition. A wipe takes the
 * seeded venues' classes with everything else, so without this the second test
 * in the file finds no `SEED.groupClass`, and (because `fileParallelism` is off
 * and the database is shared) neither does every file that runs after it.
 */
function rebuild() {
  execFileSync("node", ["scripts/test-db-reset.mjs"], { cwd: process.cwd(), stdio: "ignore" });
}

describe("clearing the whole calendar", () => {
  beforeEach(rebuild);
  // Leave the shared database as this suite found it, for whatever runs next.
  afterAll(rebuild);

  it("refuses without the typed confirmation", async () => {
    const before = await countClasses();
    expect(before).toBeGreaterThan(0);
    const founder = await asUser(FOUNDER_EMAIL);

    for (const p_confirm of [null, "", "wipe", "WIPE ", "yes"]) {
      const { error } = await founder.rpc("wipe_calendar", {
        p_scope: "all",
        p_confirm,
        p_keep_history: false,
      });
      expect(error?.message ?? "").toContain("confirm_required");
    }
    // Nothing moved on any of those attempts.
    expect(await countClasses()).toBe(before);
  });

  it("refuses anyone who is not the founder", async () => {
    const before = await countClasses();
    const client = await createClient({});
    const asClient = await asUser(client.email);
    const { error } = await asClient.rpc("wipe_calendar", {
      p_scope: "all",
      p_confirm: "WIPE",
      p_keep_history: false,
    });
    expect(error?.message ?? "").toContain("not_authorised");
    expect(await countClasses()).toBe(before);
  });

  it("clears weekly, one-off and private classes alike, and does not touch the venues", async () => {
    const coach = await createCoach();
    const oneOff = await createOneOffClass(`Wipe one-off ${uniq()}`);
    const series = await createPrivateSeries({ weekday: 3, startTime: "17:00", coachId: coach.id });

    const { count: venuesBefore } = await admin()
      .from("venues")
      .select("id", { count: "exact", head: true });
    expect(await countClasses()).toBeGreaterThan(0);

    const founder = await asUser(FOUNDER_EMAIL);
    const { data, error } = await founder.rpc("wipe_calendar", {
      p_scope: "all",
      p_confirm: "WIPE",
      p_keep_history: false,
    });
    expect(error).toBeNull();
    expect((data as { classes: number }).classes).toBeGreaterThan(0);

    // Everything, including the two kinds a selection could never reach.
    expect(await countClasses()).toBe(0);
    const { data: stillThere } = await admin()
      .from("classes")
      .select("id")
      .eq("id", oneOff)
      .maybeSingle();
    expect(stillThere).toBeNull();

    // The templates are retired, so the generator has nothing to refill from.
    const { data: pbs } = await admin()
      .from("private_booking_series")
      .select("active")
      .eq("id", series.seriesId)
      .single();
    expect(pbs!.active).toBe(false);
    await admin().rpc("generate_private_sessions", { p_weeks: 8 });
    expect(await countFutureSeriesSessions(series.seriesId)).toBe(0);
    expect(await countClasses()).toBe(0);

    // A venue is a place, not a calendar entry.
    const { count: venuesAfter } = await admin()
      .from("venues")
      .select("id", { count: "exact", head: true });
    expect(venuesAfter).toBe(venuesBefore);
  });

  it("sends one message per person however much of the calendar goes", async () => {
    const coach = await createCoach();
    // One family with a group booking AND a weekly private slot, and one coach
    // rostered on both — the pair that a two-loop implementation double-texts.
    const series = await createPrivateSeries({ weekday: 4, startTime: "17:30", coachId: coach.id });
    // The private plan carries no group access (group_sessions_per_week = 0), so
    // this family needs a group plan as well to be in both halves at once —
    // which is exactly the household the collapse has to get right.
    const { error: subErr } = await admin().from("subscriptions").insert({
      client_id: series.clientId,
      plan_id: SEED.groupPlan3x,
      source: "comp",
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    if (subErr) throw new Error(`group plan: ${subErr.message}`);
    const sessions = await createWeeklySlot({ weeks: 3, coachId: coach.id, istHour: 14 });
    for (const s of sessions.slice(0, 3))
      await bookSession({
        email: series.email,
        sessionId: s.sessionId,
        playerId: series.playerId,
      });

    const founder = await asUser(FOUNDER_EMAIL);
    const { error } = await founder.rpc("wipe_calendar", {
      p_scope: "all",
      p_confirm: "WIPE",
      p_keep_history: false,
    });
    expect(error).toBeNull();

    const clientRows = await expectNotificationCount(
      admin(),
      { userId: series.clientId, type: "session_cancelled" },
      1
    );
    expect(clientRows[0].data.collapsed).toBe(true);
    await expectNotificationCount(admin(), { userId: coach.id, type: "session_cancelled" }, 1);
  });

  it("gives the private minutes back before the rows go", async () => {
    const coach = await createCoach();
    const series = await createPrivateSeries({ weekday: 5, startTime: "18:00", coachId: coach.id });
    const weeks = await countFutureSeriesSessions(series.seriesId);
    expect(weeks).toBeGreaterThan(0);
    const before = await balance(series.clientId);

    const founder = await asUser(FOUNDER_EMAIL);
    const { data } = await founder.rpc("wipe_calendar", {
      p_scope: "all",
      p_confirm: "WIPE",
      p_keep_history: false,
    });

    expect((data as { minutes_returned: number }).minutes_returned).toBe(
      weeks * series.durationMinutes
    );
    // The ledger survives the cascade (booking_id is ON DELETE SET NULL), so the
    // family's balance is genuinely restored rather than merely recorded.
    expect(await balance(series.clientId)).toBe(before + weeks * series.durationMinutes);
  });

  it("leaves no pending reminder pointing at a session that is gone", async () => {
    const coach = await createCoach();
    const sessions = await createWeeklySlot({ weeks: 2, coachId: coach.id, istHour: 13 });
    const client = await createClient({ groupPlanId: SEED.groupPlan3x });
    await bookSession({
      email: client.email,
      sessionId: sessions[0].sessionId,
      playerId: client.playerIds[0],
    });
    await admin().from("notifications").insert({
      user_id: client.id,
      type: "reminder_upcoming",
      title: "Later today",
      body: "Your class is later today.",
      data: { session_id: sessions[0].sessionId },
      status: "pending",
    });

    const founder = await asUser(FOUNDER_EMAIL);
    await founder.rpc("wipe_calendar", {
      p_scope: "all",
      p_confirm: "WIPE",
      p_keep_history: false,
    });

    await expectNotificationCount(
      admin(),
      { userId: client.id, type: "reminder_upcoming", status: "pending" },
      0
    );
  });

  it("keeps the classes when asked, and still cancels and tells everyone", async () => {
    const coach = await createCoach();
    const sessions = await createWeeklySlot({ weeks: 2, coachId: coach.id, istHour: 12 });
    const client = await createClient({ groupPlanId: SEED.groupPlan3x });
    await bookSession({
      email: client.email,
      sessionId: sessions[0].sessionId,
      playerId: client.playerIds[0],
    });
    const before = await countClasses();

    const founder = await asUser(FOUNDER_EMAIL);
    const { data, error } = await founder.rpc("wipe_calendar", {
      p_scope: "all",
      p_confirm: "WIPE",
      p_keep_history: true,
    });
    expect(error).toBeNull();
    expect((data as { kept_history: boolean }).kept_history).toBe(true);

    // Every class survives, ended — so it is still restorable.
    expect(await countClasses()).toBe(before);
    const { data: rows } = await admin().from("classes").select("active,ends_on");
    for (const c of rows ?? []) {
      expect(c.active).toBe(false);
      expect(c.ends_on).not.toBeNull();
    }
    // …and the people on them were still told.
    await expectNotificationCount(admin(), { userId: client.id, type: "session_cancelled" }, 1);
  });

  it("writes one audit row carrying the ids it destroyed", async () => {
    await createOneOffClass(`Wipe audit ${uniq()}`);
    const expected = await countClasses();

    const founder = await asUser(FOUNDER_EMAIL);
    await founder.rpc("wipe_calendar", {
      p_scope: "all",
      p_confirm: "WIPE",
      p_keep_history: false,
    });

    const { data: rows } = await admin()
      .from("audit_log")
      .select("action,meta")
      .eq("action", "calendar.wipe")
      .order("created_at", { ascending: false })
      .limit(1);
    expect((rows ?? []).length).toBe(1);
    const meta = rows![0].meta as { classes: number; class_ids: string[] };
    expect(meta.classes).toBe(expected);
    // The ids, not just the count — after a wipe this row is the only surviving
    // record of what the calendar held.
    expect(meta.class_ids.length).toBe(expected);
  });
});
