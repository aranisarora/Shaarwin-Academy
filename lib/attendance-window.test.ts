import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_CLOSES_AFTER_MS,
  ATTENDANCE_OPENS_BEFORE_MS,
  attendanceClosedReason,
  attendanceState,
} from "@/lib/attendance-window";

/**
 * The window existed twice before this module and the two copies disagreed:
 * the roster component gated its buttons on `start - 15min` and nothing else,
 * while the server action also refused anything past `start + 48h`. A coach in
 * hour 49 got live-looking buttons and a save that failed. These pin the single
 * definition both now read.
 */
describe("attendance window", () => {
  const start = new Date("2026-08-09T10:00:00Z");
  const end = new Date("2026-08-09T11:00:00Z");
  const startsAt = start.toISOString();
  const endsAt = end.toISOString();
  const at = (ms: number) => attendanceState(startsAt, endsAt, ms);

  it("is shut until a quarter of an hour before the class", () => {
    expect(at(start.getTime() - ATTENDANCE_OPENS_BEFORE_MS - 1)).toBe("early");
  });

  it("opens exactly 15 minutes before the start, and stays open through the class", () => {
    expect(at(start.getTime() - ATTENDANCE_OPENS_BEFORE_MS)).toBe("open");
    expect(at(start.getTime())).toBe("open");
    expect(at(end.getTime())).toBe("open");
  });

  it("stays editable for a week after the class ends — the same window as the backlog", () => {
    // The equality is the point: `get_coach_wrapup_queue` chases anything that
    // ended inside 7 days, so everything it names must still be markable. The
    // old 48h ceiling meant the prompt could ask for work the app refused.
    expect(at(end.getTime() + 2 * 86_400_000)).toBe("open");
    expect(at(end.getTime() + ATTENDANCE_CLOSES_AFTER_MS)).toBe("open");
  });

  it("shuts a week and a moment after the end", () => {
    expect(at(end.getTime() + ATTENDANCE_CLOSES_AFTER_MS + 1)).toBe("closed");
  });

  it("measures the closing edge from the END, not the start", () => {
    // A three-hour session closes three hours later than a one-hour session
    // that began at the same moment — keyed on starts_at, both would have shut
    // together and the longer one would have lost time it was owed.
    const longEnd = new Date(start.getTime() + 3 * 3_600_000).toISOString();
    const justPastShort = end.getTime() + ATTENDANCE_CLOSES_AFTER_MS + 1;
    expect(at(justPastShort)).toBe("closed");
    expect(attendanceState(startsAt, longEnd, justPastShort)).toBe("open");
  });

  it("says which edge the coach is on, and only when they are on one", () => {
    expect(attendanceClosedReason("early")).toMatch(/opens 15 minutes before/i);
    expect(attendanceClosedReason("closed")).toMatch(/week|founder/i);
    expect(attendanceClosedReason("open")).toBeNull();
  });
});
