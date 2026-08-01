import { describe, it, expect } from "vitest";
import { admin } from "../../e2e/lib/supabase";
import { createCoach, createGroupSession, hoursFromNow } from "../../e2e/lib/scenario";

// Migration 0057. `founder_day_report` used to coalesce a NULL coach to the
// literal name 'Unassigned', so the 21:00 digest reported a session nobody was
// ever rostered onto as a coach who ignored the arrival prompt:
//
//   "Unassigned never marked arrival (Windmills Private, 9:00 am)"
//
// That shipped — it is in the 2026-08-01 digest. It reads as a coach-compliance
// failure, needs a completely different action from the founder, and inflates
// the count of coaches who ignored the prompt. The presentation half is pinned
// in supabase/functions/notify/digest.test.ts; this is the fact half.

/** The IST calendar date of an instant — the argument founder_day_report takes. */
function istDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

type ReportRow = {
  session_id: string;
  coach_id: string | null;
  coach_name: string | null;
  arrived_at: string | null;
};

async function report(on: Date): Promise<ReportRow[]> {
  const { data, error } = await admin().rpc("founder_day_report", { p_date: istDate(on) });
  expect(error, error?.message).toBeNull();
  return (data ?? []) as ReportRow[];
}

/** A session with no coach at all — createGroupSession runs the assignment engine. */
async function unstaffedSession(startsAt: Date) {
  const session = await createGroupSession({ startsAt });
  const { error } = await admin()
    .from("class_sessions")
    .update({ coach_id: null })
    .eq("id", session.sessionId);
  expect(error, error?.message).toBeNull();
  return session;
}

describe("founder_day_report — unassigned sessions", () => {
  it("returns a NULL coach_name for a session with no coach", async () => {
    const startsAt = hoursFromNow(2);
    const session = await unstaffedSession(startsAt);

    const row = (await report(startsAt)).find((r) => r.session_id === session.sessionId);

    expect(row, "the session is missing from the day report entirely").toBeDefined();
    expect(row!.coach_id).toBeNull();
    // The regression: anything non-null here is read downstream as a coach who
    // was rostered and then never marked arrival.
    expect(row!.coach_name).toBeNull();
    expect(row!.coach_name).not.toBe("Unassigned");
  });

  it("still names a rostered coach", async () => {
    const startsAt = hoursFromNow(3);
    const coach = await createCoach();
    const session = await createGroupSession({ startsAt, coachId: coach.id });

    const row = (await report(startsAt)).find((r) => r.session_id === session.sessionId);

    expect(row).toBeDefined();
    expect(row!.coach_id).toBe(coach.id);
    expect(row!.coach_name).toBeTruthy();
    expect(row!.coach_name).not.toBe("Unassigned");
  });

  it("keeps both kinds of session in the same day's report", async () => {
    // The digest needs to see the gap AND the staffed sessions to say anything
    // useful — dropping unassigned rows would trade one wrong line for a silent
    // one, and a class with no coach is the most actionable thing in the digest.
    const startsAt = hoursFromNow(4);
    const coach = await createCoach();
    const staffed = await createGroupSession({ startsAt, coachId: coach.id });
    const gap = await unstaffedSession(startsAt);

    const rows = await report(startsAt);
    const ids = rows.map((r) => r.session_id);

    expect(ids).toContain(staffed.sessionId);
    expect(ids).toContain(gap.sessionId);
    expect(rows.find((r) => r.session_id === gap.sessionId)!.coach_name).toBeNull();
    expect(rows.find((r) => r.session_id === staffed.sessionId)!.coach_name).toBeTruthy();
  });
});
