import { describe, it, expect } from "vitest";
import {
  summariseDay,
  summariseUnreachable,
  type DayReportRow,
  type UnreachableRow,
} from "./digest.ts";

// The 21:00 founder summary. Two defects are pinned here because both reached
// production and both were invisible in the data — they only showed up in the
// sentence the founder read:
//
//  1. An unassigned session arrived with coach_name 'Unassigned' (the old
//     coalesce in founder_day_report) and was reported as a coach who never
//     marked arrival. Migration 0057 makes coach_name NULL; these specs make
//     sure the summary keeps the two apart.
//  2. The digest reported per SESSION and truncated at three names, so it could
//     never answer "which of my coaches are actually using this?".

function row(over: Partial<DayReportRow> = {}): DayReportRow {
  return {
    class_title: "Beginners Batch",
    coach_name: "Nandhan Rao",
    time_str: "6:30 pm",
    arrived_at: "2026-08-01T13:00:00Z",
    minutes_late: 0,
    arrival_source: "wa",
    roster_size: 4,
    roster_marked: 4,
    ...over,
  };
}

/** Every line becomes one WhatsApp template variable, which may not contain a newline. */
function expectNoNewlines(s: Record<string, string>) {
  for (const [key, value] of Object.entries(s)) {
    expect(value, `${key} carries a newline — WhatsApp 63016s the send`).not.toMatch(/[\n\r\t]/);
  }
}

describe("summariseDay — per-coach arrival marking", () => {
  it("names every coach with their marked/total, worst first", () => {
    const s = summariseDay([
      row({ coach_name: "Nandhan Rao" }),
      row({ coach_name: "Nandhan Rao" }),
      row({ coach_name: "Samir Khan", arrived_at: null, minutes_late: null }),
      row({ coach_name: "Samir Khan" }),
      row({ coach_name: "Augustine Inigo", arrived_at: null, minutes_late: null }),
      row({ coach_name: "Augustine Inigo", arrived_at: null, minutes_late: null }),
      row({ coach_name: "Augustine Inigo", arrived_at: null, minutes_late: null }),
    ]);

    // 0/3 before 1/2 before 2/2 — the founder reads left to right.
    expect(s.byCoach).toBe("Augustine 0/3 · Samir 1/2 · Nandhan 2/2");
    expect(s.adoption).toBe("2 of 3 coaches marked arrival at least once");
  });

  it("counts a coach once however many sessions they taught", () => {
    const s = summariseDay([
      row({ coach_name: "Keerthana S" }),
      row({ coach_name: "Keerthana S", arrived_at: null, minutes_late: null }),
      row({ coach_name: "Keerthana S", arrived_at: null, minutes_late: null }),
    ]);
    expect(s.byCoach).toBe("Keerthana 1/3");
    expect(s.adoption).toBe("1 of 1 coach marked arrival at least once");
  });

  it("keeps full names when two coaches share a first name", () => {
    const s = summariseDay([
      row({ coach_name: "Samir Khan" }),
      row({ coach_name: "Samir Patel", arrived_at: null, minutes_late: null }),
    ]);
    expect(s.byCoach).toBe("Samir Patel 0/1 · Samir Khan 1/1");
  });

  it("truncates past ten coaches rather than overflowing the variable", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      row({ coach_name: `Coach${String(i).padStart(2, "0")} X`, arrived_at: null, minutes_late: null })
    );
    const s = summariseDay(many);
    expect(s.byCoach).toMatch(/ · \+2 more$/);
    expect(s.byCoach.match(/\d\/1/g) ?? []).toHaveLength(10);
  });
});

describe("summariseDay — unassigned sessions are not a coach failure", () => {
  const withGap = [
    row({ coach_name: "Nandhan Rao" }),
    row({ coach_name: null, class_title: "Windmills Private", time_str: "9:00 am" }),
  ];

  it("reports the gap as a missing coach, not as a coach who never marked", () => {
    const s = summariseDay(withGap);
    expect(s.attention).toContain("Windmills Private (9:00 am) had NO coach");
    // The exact production regression: 'Unassigned never marked arrival (...)'.
    expect(s.attention).not.toMatch(/never marked arrival/);
    expect(s.attention).not.toMatch(/Unassigned/);
  });

  it("excludes it from the punctuality denominator", () => {
    // One staffed session, on time — not "1 of 2".
    expect(summariseDay(withGap).punctuality).toBe("1 of 1 session started on time");
  });

  it("excludes it from the per-coach line entirely", () => {
    const s = summariseDay(withGap);
    expect(s.byCoach).toBe("Nandhan 1/1");
    expect(s.adoption).toBe("1 of 1 coach marked arrival at least once");
  });

  it("handles a day that was ONLY unassigned sessions without dividing by zero", () => {
    const s = summariseDay([row({ coach_name: null }), row({ coach_name: null })]);
    expect(s.punctuality).toBe("no staffed sessions today");
    expect(s.byCoach).toBe("no coaches on today");
    expect(s.adoption).toBe("no coaches on today");
    expectNoNewlines(s);
  });
});

describe("summariseDay — punctuality and rosters", () => {
  it("separates late from never-arrived", () => {
    const s = summariseDay([
      row({ coach_name: "Samir Khan", minutes_late: 12 }),
      row({ coach_name: "Augustine Inigo", arrived_at: null, minutes_late: null }),
      row({ coach_name: "Nandhan Rao" }),
    ]);
    expect(s.punctuality).toContain("1 of 3 sessions started on time");
    expect(s.punctuality).toContain("Samir Khan 12 min late (Beginners Batch)");
    // Never-arrived is not lateness — it belongs to the per-coach line.
    expect(s.punctuality).not.toContain("Augustine");
  });

  it("does not count a session nobody booked against the roster figure", () => {
    const s = summariseDay([
      row({ roster_size: 0, roster_marked: 0 }),
      row({ roster_size: 3, roster_marked: 3 }),
    ]);
    expect(s.rosters).toBe("1 of 1 rosters marked");
  });

  it("calls a clean day clean", () => {
    expect(summariseDay([row(), row()]).attention).toBe("Nothing — a clean day.");
  });
});

describe("summariseDay — WhatsApp template safety", () => {
  it("never emits a newline in any line, on a busy mixed day", () => {
    const s = summariseDay([
      ...Array.from({ length: 6 }, () =>
        row({ coach_name: "Augustine Inigo", arrived_at: null, minutes_late: null })
      ),
      ...Array.from({ length: 4 }, () => row({ coach_name: null })),
      row({ coach_name: "Samir Khan", minutes_late: 40, roster_size: 5, roster_marked: 0 }),
      row({ coach_name: "Nandhan Rao" }),
    ]);
    expectNoNewlines(s);
    // Truncation markers, so the founder knows the line is not the whole story.
    expect(s.attention).toContain("+1 more with no coach");
  });
});

// ── Unreachable people ──────────────────────────────────────────────────────
//
// With email gone, a row that fails WhatsApp and has no usable push reaches
// nobody. The immediate ops_unreachable alert covers the messages that needed
// an answer; everything else surfaces only here, so if this line is wrong the
// failure is invisible.

function unreachable(over: Partial<UnreachableRow> = {}): UnreachableRow {
  return { name: "Riyansh", reason: "no_phone", ...over };
}

describe("summariseUnreachable", () => {
  it("says nothing when everyone was reachable", () => {
    expect(summariseUnreachable([])).toBe("");
  });

  it("names who could not be reached and why", () => {
    const line = summariseUnreachable([
      unreachable({ name: "Riyansh", reason: "no_phone" }),
      unreachable({ name: "Shilpa Sawarthia", reason: "failed" }),
    ]);
    expect(line).toBe(
      "Couldn't reach 2 people today: Riyansh (no WhatsApp number), Shilpa Sawarthia (send failed)"
    );
  });

  it("counts people, not messages", () => {
    // Somebody with no number fails every message they were due that day.
    // Reporting each would bury every other line in the digest.
    const line = summariseUnreachable(
      Array.from({ length: 12 }, () => unreachable({ name: "Riyansh" }))
    );
    expect(line).toBe("Couldn't reach 1 person today: Riyansh (no WhatsApp number)");
  });

  it("prefers the actionable reason when one person has both", () => {
    // "add a number" is a fix; "the send failed" is a symptom of the same thing.
    const line = summariseUnreachable([
      unreachable({ name: "Riyansh", reason: "failed" }),
      unreachable({ name: "Riyansh", reason: "no_phone" }),
    ]);
    expect(line).toContain("no WhatsApp number");
    expect(line).not.toContain("send failed");
  });

  it("truncates rather than running off the end of a phone", () => {
    const line = summariseUnreachable(
      Array.from({ length: 7 }, (_, i) => unreachable({ name: `Person ${i}` }))
    );
    expect(line).toContain("Couldn't reach 7 people today");
    expect(line).toContain("+3 more");
  });

  it("falls back to a placeholder for a profile with no name", () => {
    expect(summariseUnreachable([unreachable({ name: "  " })])).toContain("Someone");
  });

  it("never emits a newline", () => {
    // A newline is legal in a WhatsApp template body and illegal in a template
    // VARIABLE — Twilio 63016s the whole send. This string is folded into
    // `attention`, which is one variable of founder_daily_digest_v3.
    const line = summariseUnreachable([
      unreachable({ name: "Line\nBreak" }),
      unreachable({ name: "Tab\tCharacter", reason: "failed" }),
    ]);
    expect(line).not.toMatch(/[\n\r\t]/);
  });
});

describe("summariseDay — the unreachable rollup", () => {
  it("appends the line to `attention` so the live template renders it", () => {
    // Deliberately folded into an existing variable rather than added as a
    // fifth: founder_daily_digest_v3 declares four, so a new line would need a
    // template revision before anyone saw it.
    const s = summariseDay([row()], [unreachable({ name: "Riyansh" })]);
    expect(s.attention).toContain("Couldn't reach 1 person today");
    expectNoNewlines(s);
  });

  it("does not call a day clean when somebody was unreachable", () => {
    const s = summariseDay([row()], [unreachable()]);
    expect(s.attention).not.toContain("clean day");
  });

  it("still reads clean when nothing failed", () => {
    expect(summariseDay([row()], []).attention).toBe("Nothing — a clean day.");
    // The argument is optional, so every existing caller keeps working.
    expect(summariseDay([row()]).attention).toBe("Nothing — a clean day.");
  });

  it("puts the sessions before the plumbing", () => {
    // A founder scans this line left to right and wants today's coaching first.
    const s = summariseDay(
      [row({ coach_name: null, class_title: "Beginners Batch" })],
      [unreachable()]
    );
    expect(s.attention.indexOf("had NO coach")).toBeLessThan(s.attention.indexOf("Couldn't reach"));
  });
});
