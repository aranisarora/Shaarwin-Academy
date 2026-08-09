// Why this file exists: a client reported seeing only some of their classes on
// /app/schedule while the player profile listed every one of them. Nothing was
// missing — `getMyBookings` ordered the embedded session instead of the rows, so
// a household on two weekly slots got 10, 17, 24, 31 Aug and then back to 11 Aug,
// and a parent reading down the list concluded the rest weren't booked. The
// profile looked right only because it sorts in JS.
//
// The query fix lives in getMyBookings; these tests pin the half that can be
// checked without a database — that the tabs are a partition (nothing fetched
// can fall between them) and that each one is sorted the way it's read.

import { describe, it, expect } from "vitest";
import { isUpcoming, splitBookings, type MyBooking } from "@/lib/booking";

const AUG = (day: number) => `2026-08-${String(day).padStart(2, "0")}T10:30:00+00:00`;
const NOW = new Date("2026-08-09T12:00:00+00:00").getTime();

function booking(starts_at: string, status = "confirmed", id = starts_at): MyBooking {
  return {
    id,
    status,
    waitlist_position: null,
    seriesId: null,
    privateSeriesId: null,
    playerId: null,
    playerName: "",
    session: {
      id: `s-${id}`,
      starts_at,
      ends_at: starts_at,
      classTitle: "Private",
      isPrivate: true,
      venueName: null,
      coachName: null,
      address: null,
    },
  };
}

const days = (bookings: MyBooking[]) =>
  bookings.map((b) => Number(b.session.starts_at.slice(8, 10)));

describe("splitBookings", () => {
  it("sorts the upcoming tab soonest-first from the order production actually returned", () => {
    // Two weekly slots read back slot-by-slot — the exact shape the live API gave.
    const scrambled = [10, 17, 24, 31, 11, 18, 25].map((d) => booking(AUG(d)));
    expect(days(splitBookings(scrambled, NOW).upcoming)).toEqual([
      10, 11, 17, 18, 24, 25, 31,
    ]);
  });

  it("sorts the past tab newest-first, the way history reads", () => {
    const played = [
      booking(AUG(1), "attended"),
      booking(AUG(8), "attended"),
      booking(AUG(5), "no_show"),
    ];
    expect(days(splitBookings(played, NOW).past)).toEqual([8, 5, 1]);
  });

  it("keeps every booking — the two tabs are a partition, not two filters", () => {
    // An attended booking that hasn't started yet: the register marked early.
    // Under the old pair of independent filters this matched neither tab and
    // disappeared, which is the bug in its purest form.
    const early = booking(AUG(20), "attended");
    const { upcoming, past } = splitBookings([early], NOW);
    expect(upcoming).toHaveLength(0);
    expect(past).toEqual([early]);
  });

  it("loses nothing across a mixed list", () => {
    const all = [
      booking(AUG(17)),
      booking(AUG(1), "attended"),
      booking(AUG(10), "waitlisted"),
      booking(AUG(20), "no_show"),
      booking(AUG(5), "confirmed"),
    ];
    const { upcoming, past } = splitBookings(all, NOW);
    expect(upcoming.length + past.length).toBe(all.length);
    expect([...upcoming, ...past].map((b) => b.id).sort()).toEqual(
      all.map((b) => b.id).sort()
    );
  });

  it("counts a waitlisted seat as upcoming — it's still a place to turn up for", () => {
    const { upcoming } = splitBookings([booking(AUG(20), "waitlisted")], NOW);
    expect(upcoming).toHaveLength(1);
  });

  it("puts a session already under way in the past tab", () => {
    const started = booking(new Date(NOW - 60_000).toISOString());
    expect(splitBookings([started], NOW).past).toHaveLength(1);
  });
});

describe("isUpcoming", () => {
  it("is false once the start has passed, whatever the status", () => {
    expect(isUpcoming(booking(AUG(1)), NOW)).toBe(false);
    expect(isUpcoming(booking(AUG(20)), NOW)).toBe(true);
  });

  it("is false for a booking that has already been marked", () => {
    expect(isUpcoming(booking(AUG(20), "attended"), NOW)).toBe(false);
    expect(isUpcoming(booking(AUG(20), "no_show"), NOW)).toBe(false);
  });
});
