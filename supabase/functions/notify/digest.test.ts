import { describe, it, expect } from "vitest";
import { summariseDay, type DayReportRow } from "./digest.ts";

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
