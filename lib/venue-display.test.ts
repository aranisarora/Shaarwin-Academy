// The resolver these tests used to cover is gone. A location is now two stored
// fields chosen by a human at booking (migrations 0052-0054), so what's left to
// pin is how those fields are spelled — and the guard that stops a complex
// producing an ambiguous one.
//
// `venue_display(venues)` and `location_label(classes)` in SQL are the mirrors
// of venueDisplayName and composeLocationLabel. Change one, change the other;
// tests/db/venue-label.test.ts covers the SQL side.

import { describe, it, expect } from "vitest";
import {
  composeLocationLabel,
  venueDisplayName,
  venueKeyOf,
  venueNeedsUnit,
} from "@/lib/venue-display";

describe("venueDisplayName", () => {
  it("appends the unit as a suffix of the name", () => {
    expect(
      venueDisplayName({ name: "Adarsh Palm Retreat", unit: "Villas" })
    ).toBe("Adarsh Palm Retreat Villas");
  });

  it("leaves a whole-place venue alone", () => {
    expect(venueDisplayName({ name: "La Palazzo", unit: null })).toBe("La Palazzo");
    expect(venueDisplayName({ name: "La Palazzo" })).toBe("La Palazzo");
  });

  it("trims — one venue on the book stored a trailing space", () => {
    expect(venueDisplayName({ name: "La Palazzo ", unit: "  " })).toBe("La Palazzo");
  });
});

describe("composeLocationLabel", () => {
  it("joins venue and unit with a comma", () => {
    expect(composeLocationLabel("Adarsh Palm Retreat Villas", "Clubhouse")).toBe(
      "Adarsh Palm Retreat Villas, Clubhouse"
    );
  });

  it("keeps the venue alone when there's no unit", () => {
    expect(composeLocationLabel("Divyasree", null)).toBe("Divyasree");
    expect(composeLocationLabel("Divyasree", "  ")).toBe("Divyasree");
  });

  it("is null without a venue, so callers can fall back to the raw address", () => {
    expect(composeLocationLabel(null, "Flat 4092")).toBeNull();
    expect(composeLocationLabel("  ", "Flat 4092")).toBeNull();
  });

  it("never shows a unit without the venue detail that disambiguates it", () => {
    // The whole point of the model: the villas' clubhouse and the apartments'
    // clubhouse are mutually inaccessible, so a bare "Clubhouse" is a
    // wrong-gate bug. The venue part always carries the unit that separates
    // them, because location_label composes venue_display first.
    const villas = venueDisplayName({ name: "Adarsh Palm Retreat", unit: "Villas" });
    const towers = venueDisplayName({ name: "Adarsh Palm Retreat", unit: "Apartments" });
    expect(composeLocationLabel(villas, "Clubhouse")).toBe(
      "Adarsh Palm Retreat Villas, Clubhouse"
    );
    expect(composeLocationLabel(villas, "Clubhouse")).not.toBe(
      composeLocationLabel(towers, "Clubhouse")
    );
  });
});

describe("venueNeedsUnit", () => {
  const others = [
    { name: "Adarsh Palm Retreat", unit: "Villas" },
    { name: "La Palazzo", unit: null },
  ];

  it("requires a unit once a complex has a second venue", () => {
    expect(venueNeedsUnit({ name: "Adarsh Palm Retreat", unit: null }, others)).toBe(
      true
    );
  });

  it("is satisfied by any unit", () => {
    expect(
      venueNeedsUnit({ name: "Adarsh Palm Retreat", unit: "Apartments" }, others)
    ).toBe(false);
  });

  it("ignores case and surrounding space when matching the name", () => {
    expect(venueNeedsUnit({ name: "  adarsh palm retreat ", unit: "" }, others)).toBe(
      true
    );
  });

  it("leaves a genuinely unique venue alone", () => {
    expect(venueNeedsUnit({ name: "Greenage", unit: null }, others)).toBe(false);
  });
});

// The Location filter is shared by both views of the Schedule tab, and the two
// views spell a place differently: This week reads `location_label(classes)`,
// which appends ", <unit>" for a private at a family's home, while the Timetable
// stores only `venue_display(venues)`. One chip cannot drive both unless the
// doorway comes off first.
describe("venueKeyOf", () => {
  it("drops the unit a private session's label carries", () => {
    expect(venueKeyOf("Adarsh Palm Retreat Villas, Villa 659")).toBe(
      "Adarsh Palm Retreat Villas"
    );
  });

  it("leaves a group class's label alone — it never has a unit", () => {
    expect(venueKeyOf("Adarsh Palm Retreat Villas")).toBe("Adarsh Palm Retreat Villas");
  });

  it("agrees with venueDisplayName, which is what the Timetable filters on", () => {
    const venue = { name: "Adarsh Palm Retreat", unit: "Villas" };
    expect(venueKeyOf(composeLocationLabel(venueDisplayName(venue), "Villa 659"))).toBe(
      venueDisplayName(venue)
    );
  });

  it("keeps a comma that isn't a unit separator", () => {
    // composeLocationLabel only ever joins with ", ", so a bare comma inside a
    // venue's own name must survive.
    expect(venueKeyOf("Greenage,Phase 2")).toBe("Greenage,Phase 2");
  });

  it("is empty for nothing at all", () => {
    expect(venueKeyOf(null)).toBe("");
    expect(venueKeyOf(undefined)).toBe("");
    expect(venueKeyOf("   ")).toBe("");
  });
});
