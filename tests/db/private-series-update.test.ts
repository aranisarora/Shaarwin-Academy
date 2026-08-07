// Moving a family's standing weekly slot.
//
// A `private_booking_series` row is a TEMPLATE, and the weeks it has already
// produced are real sessions with real bookings against them. That split is the
// whole difficulty: `generate_private_sessions` skips any week that already
// carries a booking, so changing only the template moves nothing that exists.
// The family's Tuesday would stay Tuesday for every week already generated and
// become Thursday only after the horizon ran out — a slot that is two different
// slots depending how far ahead you look, with nothing on any screen to say so.
//
// So these tests assert on the SESSIONS, not on the template row. A pass that
// only checked `private_booking_series.weekday` would be green against exactly
// the bug this code exists to avoid.

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import { admin, asUser } from "../../e2e/lib/supabase";
import { createCoach, createPrivateSeries, SEED } from "../../e2e/lib/scenario";
import { updatePrivateSeriesCore } from "../../lib/admin-ops-private-series";

const FOUNDER_EMAIL = "founder@sharwin.example";
const typed = (c: SupabaseClient) => c as unknown as SupabaseClient<Database>;
const IST_OFFSET_MIN = 330;

/** The future sessions this series has already put on the calendar. */
async function futureSessions(seriesId: string) {
  const { data, error } = await admin()
    .from("bookings")
    .select("class_sessions!inner(id,starts_at,coach_id,status)")
    .eq("private_series_id", seriesId)
    .gt("class_sessions.starts_at", new Date().toISOString())
    .eq("class_sessions.status", "scheduled");
  if (error) throw new Error(`futureSessions: ${error.message}`);
  return (data ?? []).map(
    (b) => b.class_sessions as unknown as { id: string; starts_at: string; coach_id: string | null }
  );
}

/** ISO weekday (1 = Monday) of an instant, read in academy time. */
function istWeekday(iso: string): number {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

/** "HH:MM" of an instant, read in academy time. */
function istTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

async function notificationsFor(userId: string, type: string): Promise<number> {
  const { data, error } = await admin()
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type);
  if (error) throw new Error(`notificationsFor: ${error.message}`);
  return (data ?? []).length;
}

describe("moving a weekly private slot", () => {
  it("carries the weeks already on the calendar across to the new slot", async () => {
    const coach = await createCoach();
    const s = await createPrivateSeries({ weekday: 3, startTime: "17:00", coachId: coach.id });

    // The control: without generated weeks this would pass against a series
    // that had never produced anything to move.
    const before = await futureSessions(s.seriesId);
    expect(before.length).toBeGreaterThan(0);
    for (const row of before) {
      expect(istWeekday(row.starts_at)).toBe(3);
      expect(istTime(row.starts_at)).toBe("17:00");
    }

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await updatePrivateSeriesCore(typed(founder), SEED.founder, s.seriesId, {
      weekday: 5,
      startTime: "18:30",
    });
    expect(r.ok).toBe(true);
    expect(r.movedSessions).toBe(before.length);

    // The template moved…
    const { data: row } = await admin()
      .from("private_booking_series")
      .select("weekday,start_time")
      .eq("id", s.seriesId)
      .single();
    expect(row?.weekday).toBe(5);
    expect(String(row?.start_time).slice(0, 5)).toBe("18:30");

    // …and so did every week it had already generated. This is the assertion
    // that fails if the template alone is updated.
    const after = await futureSessions(s.seriesId);
    expect(after.length).toBe(before.length);
    for (const sess of after) {
      expect(istWeekday(sess.starts_at)).toBe(5);
      expect(istTime(sess.starts_at)).toBe("18:30");
    }
  });

  it("tells the family once, however many weeks moved", async () => {
    const coach = await createCoach();
    // 19:45 rather than a round hour on purpose. These specs share one database,
    // and open-private-slot.test.ts asserts that NO active series exists at
    // 16:00 — "nothing else in this spec creates a client, so any active series
    // is ours". A series parked on a popular time here makes that spec fail from
    // three files away, which is a miserable thing to debug.
    const s = await createPrivateSeries({ weekday: 2, startTime: "19:45", coachId: coach.id });
    const weeks = (await futureSessions(s.seriesId)).length;
    expect(weeks).toBeGreaterThan(1);

    const beforeCount = await notificationsFor(s.clientId, "session_moved");

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await updatePrivateSeriesCore(typed(founder), SEED.founder, s.seriesId, {
      weekday: 4,
      startTime: "19:45",
    });
    expect(r.ok).toBe(true);

    // One decision, one message. Looping moveSession over the weeks would have
    // sent `weeks` of them for a single change the founder made once.
    const afterCount = await notificationsFor(s.clientId, "session_moved");
    expect(afterCount - beforeCount).toBe(1);
  });

  it("changes the coach on the weeks already booked, and says nothing to the family", async () => {
    const first = await createCoach();
    const second = await createCoach();
    const s = await createPrivateSeries({ weekday: 1, startTime: "15:00", coachId: first.id });
    expect((await futureSessions(s.seriesId)).length).toBeGreaterThan(0);

    const beforeClient = await notificationsFor(s.clientId, "session_moved");

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await updatePrivateSeriesCore(typed(founder), SEED.founder, s.seriesId, {
      preferredCoach: second.id,
    });
    expect(r.ok).toBe(true);

    const { data: row } = await admin()
      .from("private_booking_series")
      .select("preferred_coach")
      .eq("id", s.seriesId)
      .single();
    expect(row?.preferred_coach).toBe(second.id);

    for (const sess of await futureSessions(s.seriesId)) {
      expect(sess.coach_id).toBe(second.id);
    }

    // The slot did not move, so nothing about the family's week changed. Telling
    // them their session moved when it did not is how a channel stops being read.
    expect(await notificationsFor(s.clientId, "session_moved")).toBe(beforeClient);
    // Both coaches hear: one lost it, one gained it.
    expect(await notificationsFor(first.id, "session_moved")).toBeGreaterThan(0);
    expect(await notificationsFor(second.id, "session_moved")).toBeGreaterThan(0);
  });

  it("refuses to change a slot that has already ended", async () => {
    const s = await createPrivateSeries({ weekday: 6, startTime: "09:00" });
    await admin().from("private_booking_series").update({ active: false }).eq("id", s.seriesId);

    const founder = await asUser(FOUNDER_EMAIL);
    const r = await updatePrivateSeriesCore(typed(founder), SEED.founder, s.seriesId, {
      weekday: 2,
    });
    // A retired template is not generating weeks, so "moving" it would silently
    // do nothing the founder could see — say so instead.
    expect(r.ok).toBe(false);
  });
});
