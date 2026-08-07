// The occurrence maths behind both the clash preview and the class insert.
//
// These cases exist because the version this replaced walked the SERVER's local
// calendar (`new Date().getFullYear()`, `.getMonth()`, `.getDate()`) to decide
// which days were Tuesdays, then converted to IST afterwards. On a host west of
// Kolkata — every Vercel region the app has ever run in — "today" on that
// calendar is yesterday in Bengaluru for five and a half hours out of every
// twenty-four. So a class published late in the IST evening could generate a
// different set of weeks than the one the founder was looking at, and stamp a
// `starts_on` a day out.
//
// A clock is not something to wait for, so every case here hands `now` in.

import { describe, it, expect } from "vitest";
import { isoWeekdayOfWallDate, overlaps, weeklyOccurrences } from "./slot-clashes";
import { utcToAcademyWall } from "./academy-time";

/** IST is a fixed UTC+5:30, so a wall time maps to one instant with no DST. */
const istInstant = (wall: string) => new Date(`${wall}+05:30`);

describe("isoWeekdayOfWallDate", () => {
  it("reads a calendar date the same wherever the server is", () => {
    // 2026-08-07 is a Friday.
    expect(isoWeekdayOfWallDate("2026-08-07")).toBe(5);
    expect(isoWeekdayOfWallDate("2026-08-09")).toBe(7); // Sunday is 7, not 0
    expect(isoWeekdayOfWallDate("2026-08-10")).toBe(1);
  });

  it("does not shift across a month or year boundary", () => {
    expect(isoWeekdayOfWallDate("2026-01-01")).toBe(4); // Thursday
    expect(isoWeekdayOfWallDate("2025-12-31")).toBe(3);
  });
});

describe("overlaps", () => {
  it("treats back-to-back sessions as not clashing", () => {
    // 6:30–7:30 and 7:30–8:30. Half-open, exactly as Postgres's tstzrange
    // default `[)` — the rule coach_no_overlap is enforcing.
    expect(overlaps(630, 730, 730, 830)).toBe(false);
    expect(overlaps(730, 830, 630, 730)).toBe(false);
  });

  it("catches a session that starts inside another", () => {
    expect(overlaps(630, 730, 700, 800)).toBe(true);
    expect(overlaps(700, 800, 630, 730)).toBe(true);
  });

  it("catches one session wholly inside another", () => {
    expect(overlaps(600, 900, 700, 730)).toBe(true);
    expect(overlaps(700, 730, 600, 900)).toBe(true);
  });
});

describe("weeklyOccurrences", () => {
  it("returns that weekday, at that IST wall time, every week", () => {
    const now = istInstant("2026-08-07T09:00"); // Friday morning IST
    const occ = weeklyOccurrences("TU", "18:30", 8, now);

    expect(occ.length).toBeGreaterThanOrEqual(8);
    for (const d of occ) {
      const wall = utcToAcademyWall(d);
      expect(wall.time).toBe("18:30");
      expect(wall.isoWeekday).toBe(2);
    }
    // Strictly increasing, exactly a week apart.
    for (let i = 1; i < occ.length; i++) {
      expect(occ[i].getTime() - occ[i - 1].getTime()).toBe(7 * 86_400_000);
    }
  });

  it("never offers a slot that has already gone", () => {
    // Tuesday, 8:00 pm IST — that evening's 6:30 class is over.
    const now = istInstant("2026-08-11T20:00");
    const occ = weeklyOccurrences("TU", "18:30", 8, now);
    expect(occ.every((d) => d > now)).toBe(true);
    expect(utcToAcademyWall(occ[0]).date).toBe("2026-08-18");
  });

  it("keeps a slot still ahead of us on the same day", () => {
    // Same Tuesday, but at 9am — 6:30pm has not happened yet, so it counts.
    const now = istInstant("2026-08-11T09:00");
    const occ = weeklyOccurrences("TU", "18:30", 8, now);
    expect(utcToAcademyWall(occ[0]).date).toBe("2026-08-11");
  });

  it("agrees with itself either side of IST midnight", () => {
    // THE regression case. 23:50 IST on Friday and 00:10 IST on Saturday are 20
    // minutes apart, and the server's own date flips between them (18:20 UTC →
    // 18:40 UTC is the same UTC day, but the OLD code used local time, where a
    // US-hosted server was on a different date entirely).
    //
    // These two instants are on different IST days, so the honest expectation
    // is not an identical list — it is that each is a correct list for its own
    // day, with the later one being the earlier one minus anything now past.
    const late = weeklyOccurrences("MO", "10:00", 8, istInstant("2026-08-07T23:50"));
    const earlyNextDay = weeklyOccurrences("MO", "10:00", 8, istInstant("2026-08-08T00:10"));

    for (const d of [...late, ...earlyNextDay]) {
      const wall = utcToAcademyWall(d);
      expect(wall.time).toBe("10:00");
      expect(wall.isoWeekday).toBe(1);
    }
    // No Monday between 23:50 Fri and 00:10 Sat, so the head must not move.
    expect(earlyNextDay[0].getTime()).toBe(late[0].getTime());
  });

  it("builds the same instants whatever the host's own timezone thinks", () => {
    // The instants are absolute, so this is really a check that nothing in the
    // path reads the ambient zone: the wall reading of each occurrence must be
    // the requested one, and that is true only if IST did the arithmetic.
    const occ = weeklyOccurrences("SA", "07:15", 4, istInstant("2026-08-07T12:00"));
    expect(occ.length).toBeGreaterThanOrEqual(4);
    expect(utcToAcademyWall(occ[0])).toMatchObject({ time: "07:15", isoWeekday: 6 });
    // 07:15 IST is 01:45 UTC — the day before would be a 5½-hour error.
    expect(occ[0].toISOString().slice(11, 16)).toBe("01:45");
  });

  it("gives back nothing for a weekday code it does not recognise", () => {
    expect(weeklyOccurrences("XX", "18:30", 8, istInstant("2026-08-07T09:00"))).toEqual([]);
  });

  it("covers the window it was asked for, not a hardcoded eight weeks", () => {
    const now = istInstant("2026-08-07T09:00");
    expect(weeklyOccurrences("WE", "18:30", 2, now).length).toBeLessThanOrEqual(3);
    expect(weeklyOccurrences("WE", "18:30", 12, now).length).toBeGreaterThanOrEqual(12);
  });
});
