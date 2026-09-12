// Open private slots — the "no client, assign later" path of
// createPrivateSessionCore.
//
// The admin sheet used to force these to a single session because a standing
// weekly slot is a private_booking_series row, and that table's client_id and
// player_id are NOT NULL. But the series is only the rolling template: the
// occurrences themselves never needed a client, so an open slot can be held for
// N weeks the same way a client booking is. These tests pin that — N held
// sessions, no booking, no minutes moved, no series — and the coach hearing
// about the whole run once rather than per week.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import { createCoach } from "../../e2e/lib/scenario";
import { createPrivateSessionCore } from "../../lib/admin-ops-calendar";
import { expectNotificationCount } from "../../e2e/lib/notifications";

const FOUNDER_EMAIL = "founder@sharwin.example";
const FOUNDER_ID = "00000000-0000-4000-8000-000000000001";

/** Tomorrow in academy wall-clock, so the first slot is always in the future. */
function tomorrow(): string {
  return new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
}

/** Holds an open slot (no clientId) for `recurWeeks` weeks on a fresh coach. */
async function holdOpenSlot(recurWeeks?: number, durationMinutes = 60) {
  const coach = await createCoach();
  const founder = await asUser(FOUNDER_EMAIL);

  const result = await createPrivateSessionCore(founder, FOUNDER_ID, {
    date: tomorrow(),
    time: "16:00",
    durationMinutes,
    address: "12 Whitefield Court, Whitefield",
    lat: 12.9698,
    lng: 77.75,
    coachId: coach.id,
    ...(recurWeeks ? { recurWeeks } : {}),
  } as Parameters<typeof createPrivateSessionCore>[2]);

  return { coach, result };
}

type Details = { client_id: string | null; player_id: string | null };
type HeldSession = {
  id: string;
  starts_at: string;
  ends_at: string;
  class_id: string;
  classes: {
    class_type: string;
    duration_minutes: number;
    private_class_details: Details | Details[] | null;
  };
};

/** private_class_details is one-per-class, but PostgREST embeds vary by shape. */
function detailsOf(s: HeldSession): Details {
  const d = s.classes.private_class_details;
  const row = Array.isArray(d) ? d[0] : d;
  if (!row) throw new Error("session has no private_class_details row");
  return row;
}

/** Every session held for this coach, oldest first. */
async function sessionsFor(coachId: string) {
  const { data } = await admin()
    .from("class_sessions")
    .select(
      "id,starts_at,ends_at,class_id,classes!inner(class_type,duration_minutes,private_class_details(client_id,player_id))"
    )
    .eq("coach_id", coachId)
    .order("starts_at");
  return (data ?? []) as unknown as HeldSession[];
}

describe("open private slots", () => {
  it("holds one empty session, unbooked and uncharged", async () => {
    const { coach, result } = await holdOpenSlot();
    expect(result.ok).toBe(true);

    const sessions = await sessionsFor(coach.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].classes.class_type).toBe("private");
    // Held, not booked: nobody on the details and no booking row.
    expect(detailsOf(sessions[0]).client_id).toBeNull();
    expect(detailsOf(sessions[0]).player_id).toBeNull();
    const { count } = await admin()
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessions[0].id);
    expect(count ?? 0).toBe(0);
  });

  it("holds every week of a repeat, a week apart", async () => {
    const { coach, result } = await holdOpenSlot(4);
    expect(result.ok).toBe(true);

    const sessions = await sessionsFor(coach.id);
    expect(sessions).toHaveLength(4);
    for (const s of sessions) {
      expect(detailsOf(s).client_id).toBeNull();
    }
    // Same weekday and time each week — exactly 7 days between occurrences.
    const gap =
      new Date(sessions[1].starts_at).getTime() - new Date(sessions[0].starts_at).getTime();
    expect(gap).toBe(7 * 86400_000);
  });

  it("moves no minutes and stands up no series", async () => {
    const { coach, result } = await holdOpenSlot(4);
    expect(result.ok).toBe(true);

    const sessions = await sessionsFor(coach.id);
    const { count: bookings } = await admin()
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("session_id", sessions.map((s) => s.id));
    expect(bookings ?? 0).toBe(0);

    // A series is keyed to a client — an open run must not invent one. Nothing
    // else in this spec creates a client, so any active series is ours.
    const { count: series } = await admin()
      .from("private_booking_series")
      .select("id", { count: "exact", head: true })
      .eq("start_time", "16:00:00")
      .eq("active", true);
    expect(series ?? 0).toBe(0);
  });

  it("tells the coach once about the whole run, not once a week", async () => {
    const { coach, result } = await holdOpenSlot(4);
    expect(result.ok).toBe(true);

    // An open run is not a series, so the coach copy can't key off that — it
    // counts sessions. Getting this wrong told the coach about one session
    // while four sat on their schedule.
    const rows = await expectNotificationCount(
      admin(),
      { userId: coach.id, type: "new_private_session" },
      1
    );
    expect(rows[0].data.session_count).toBe(4);
    expect(String(rows[0].body)).toContain("4 sessions");
  });

  // The length asked for is the length booked. createPrivateSessionCore pinned
  // this to 60-or-90 regardless of what it was handed, so a two-hour private
  // was written as a one-hour one — silently, since nothing failed and the
  // session simply appeared an hour short. The clamp is now the classes table's
  // own 30–360, which is the list the admin sheet offers.
  it("keeps a length outside the old 60/90 pair", async () => {
    const { coach, result } = await holdOpenSlot(undefined, 120);
    expect(result.ok).toBe(true);

    const [session] = await sessionsFor(coach.id);
    expect(session.classes.duration_minutes).toBe(120);
    const held =
      new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime();
    expect(held).toBe(120 * 60_000);
  });
});
