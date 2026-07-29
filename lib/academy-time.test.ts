// istDayBounds — the fix for "no coaching today" when there WAS coaching today.
// (notification-fix-plan, Bot changes.)

import { describe, it, expect } from "vitest";
import { istDayBounds, academyToday, utcToAcademyWall } from "./academy-time";

describe("istDayBounds", () => {
  it("starts at 00:00 today, not at this instant", () => {
    // The actual bug: a window beginning at `new Date()` hides a session that
    // started earlier today, so a coach asking at 3pm about a 2pm class is told
    // they have nothing on.
    const { start } = istDayBounds();
    expect(new Date(start).getTime()).toBeLessThanOrEqual(Date.now());

    const wall = utcToAcademyWall(new Date(start));
    expect(wall.time).toBe("00:00");
    expect(wall.date).toBe(academyToday());
  });

  it("covers exactly one day by default", () => {
    const { start, end } = istDayBounds();
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(86_400_000);
  });

  it("covers N whole days including today", () => {
    const { start, end } = istDayBounds(7);
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(7 * 86_400_000);
  });

  it("never returns an empty or inverted window", () => {
    for (const days of [-5, 0, 1]) {
      const { start, end } = istDayBounds(days);
      expect(new Date(end).getTime()).toBeGreaterThan(new Date(start).getTime());
    }
  });

  it("contains 'now', so today's sessions can't fall outside the window", () => {
    const { start, end } = istDayBounds();
    const now = Date.now();
    expect(now).toBeGreaterThanOrEqual(new Date(start).getTime());
    expect(now).toBeLessThan(new Date(end).getTime());
  });
});
