import { describe, expect, it } from "vitest";
import {
  arrivalTiming,
  LATE_ARRIVAL_GRACE_MIN,
  sessionIssues,
  type IssueInput,
} from "./session-issues";

const START = Date.parse("2026-08-11T12:30:00.000Z");
const iso = (msFromStart: number) => new Date(START + msFromStart * 60_000).toISOString();

/** A one-hour class with a coach on it and nothing outstanding. */
function session(over: Partial<IssueInput> = {}): IssueInput {
  return {
    status: "scheduled",
    starts_at: iso(0),
    ends_at: iso(60),
    coachId: "coach",
    coachArrivedAt: null,
    rosterUnmarked: 0,
    assessPending: 0,
    ...over,
  };
}

describe("arrivalTiming", () => {
  it("counts a coach who beat the class in as early", () => {
    expect(arrivalTiming(iso(-20), iso(0))).toMatchObject({
      offsetMin: -20,
      late: false,
      label: "20 min early",
    });
  });

  it("switches to hours once a gap stops being a number of minutes", () => {
    expect(arrivalTiming(iso(-60), iso(0)).label).toBe("1h early");
    expect(arrivalTiming(iso(-95), iso(0)).label).toBe("1h 35m early");
  });

  it("calls the start bell itself on time", () => {
    expect(arrivalTiming(iso(0), iso(0))).toMatchObject({ late: false, label: "on time" });
  });

  // The grace exists so the chip is believed. A coach walking in at 6:03 for a
  // 6:00 class let nobody down, and colouring that red is how a warning gets
  // learned-past.
  it("holds the grace, then goes late one minute past it", () => {
    expect(arrivalTiming(iso(LATE_ARRIVAL_GRACE_MIN), iso(0))).toMatchObject({
      late: false,
      label: "on time",
    });
    expect(arrivalTiming(iso(LATE_ARRIVAL_GRACE_MIN + 1), iso(0))).toMatchObject({
      late: true,
      label: "6 min late",
    });
  });
});

describe("sessionIssues", () => {
  it("says nothing about a class that has not started", () => {
    const i = sessionIssues(session({ rosterUnmarked: 4 }), START - 60_000);
    expect(i).toMatchObject({ noArrival: false, attendance: 0, assess: 0, any: false });
  });

  it("asks for the arrival once the class is running, but not the register", () => {
    const i = sessionIssues(session({ rosterUnmarked: 4 }), START + 30 * 60_000);
    expect(i).toMatchObject({ noArrival: true, attendance: 0, any: true });
  });

  it("asks for the register and the ratings once it is over", () => {
    const i = sessionIssues(
      session({ coachArrivedAt: iso(-5), rosterUnmarked: 4, assessPending: 2 }),
      START + 90 * 60_000
    );
    expect(i).toMatchObject({ noArrival: false, attendance: 4, assess: 2, any: true });
    expect(i.arrival?.label).toBe("5 min early");
  });

  it("does not chase an arrival on a session with nobody rostered", () => {
    const i = sessionIssues(session({ coachId: null }), START + 90 * 60_000);
    expect(i.noArrival).toBe(false);
  });

  // A late coach is a fact, not a job. Nothing on the schedule can be done
  // about one, so it must not put the session in the needs-attention list.
  it("prints a late arrival without calling it outstanding work", () => {
    const i = sessionIssues(
      session({ coachArrivedAt: iso(20) }),
      START + 90 * 60_000
    );
    expect(i.arrival).toMatchObject({ late: true, label: "20 min late" });
    expect(i.any).toBe(false);
  });

  it("owes nothing on a class that was called off", () => {
    const i = sessionIssues(
      session({ status: "cancelled", rosterUnmarked: 6, assessPending: 3 }),
      START + 90 * 60_000
    );
    expect(i).toMatchObject({ attendance: 0, assess: 0, any: false });
  });
});
