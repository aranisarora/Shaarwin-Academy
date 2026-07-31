// The resolver decides what a coach is told over WhatsApp when a private
// session has no venue_id — which is every private. Its tier order was chosen
// against the real book (167 sessions), and the cases below are the ones that
// forced each tier, so a "simplification" that breaks one of them is a
// regression in a message someone acts on.
//
// `location_label(classes)` in migration 0050 mirrors this. Change one, change
// the other; tests/db/venue-label.test.ts covers the SQL side.

import { describe, it, expect } from "vitest";
import {
  addressHead,
  isInformativePlace,
  makeVenueResolver,
} from "@/lib/venue-display";

const VENUES = [
  { name: "APR Apartments", address: "Adarsh Palm Retreat, Bengaluru, Bengaluru Urban, Karnataka, India" },
  { name: "APR Villas", address: "Lane-1 Phase-1, Bengaluru, 560103, India" },
  { name: "La Palazzo", address: "47/1, Bengaluru, 560102, India" },
];
const resolve = makeVenueResolver(VENUES);

describe("addressHead", () => {
  it("splits on the ASCII comma", () => {
    expect(addressHead("47/1, Bengaluru, 560102, India")).toBe("47/1");
  });

  it("splits on U+060C ARABIC COMMA too", () => {
    // A third of the book is geocoded with this. An ASCII-only split returns
    // the whole address, which is how "Phase 3 ، 560035 Bengaluru، India"
    // once passed for an informative place name.
    expect(addressHead("Phase 3 ، 560035 Bengaluru، India")).toBe("Phase 3");
  });

  it("is null for an empty or comma-only address", () => {
    expect(addressHead("")).toBeNull();
    expect(addressHead(null)).toBeNull();
    expect(addressHead(" , ")).toBeNull();
  });
});

describe("isInformativePlace", () => {
  it("accepts a real street", () => {
    expect(isInformativePlace("Prestige Mayberry Road 34", "Bengaluru")).toBe(true);
    expect(isInformativePlace("6th Main Road 2", "Bengaluru")).toBe(true);
  });

  it("rejects a bare plot number", () => {
    expect(isInformativePlace("51/3", "Bengaluru")).toBe(false);
  });

  it("rejects the city, state and country", () => {
    expect(isInformativePlace("Bengaluru", "Bengaluru")).toBe(false);
    expect(isInformativePlace("India", null)).toBe(false);
    expect(isInformativePlace("Karnataka", null)).toBe(false);
  });

  it("rejects a sub-unit designator that means nothing without its complex", () => {
    for (const s of ["Phase 3", "Lane 1", "Block A", "Tower 2", "Sy No 36/3"]) {
      expect(isInformativePlace(s, "Bengaluru")).toBe(false);
    }
  });

  it("keeps a name that merely starts with a sub-unit word", () => {
    // "Lane" alone is noise; "Lane Bridge Apartments" is a place.
    expect(isInformativePlace("Lane Bridge Apartments", "Bengaluru")).toBe(true);
  });
});

describe("makeVenueResolver", () => {
  it("names the venue when the address is that venue's address", () => {
    expect(resolve({ address: "47/1, Bengaluru, 560102, India" })).toBe("La Palazzo");
  });

  it("matches the venue through case and stray whitespace", () => {
    expect(resolve({ address: "  47/1,  BENGALURU, 560102, India  " })).toBe("La Palazzo");
  });

  it("prefers the geocoded POI name over the street", () => {
    expect(
      resolve({
        address: "51/3, Bengaluru, 560067, India",
        address_details: { name: "Windmills of your mind, Back Gate" },
      })
    ).toBe("Windmills of your mind, Back Gate");
  });

  it("keeps a real street rather than dropping to the neighbourhood", () => {
    // The regression that ordering locality above the street would have caused.
    expect(
      resolve({
        address: "Prestige Mayberry Road 34، 560067 Bengaluru، India",
        address_details: { locality: "Chansandra", city: "Bengaluru" },
      })
    ).toBe("Prestige Mayberry Road 34");
  });

  it("falls back to the locality when the address head is junk", () => {
    // Mapbox models a gated complex as a locality, so this is the tier that
    // turns a label naming a city of 14 million into the complex everyone says.
    expect(
      resolve({
        address: "Bengaluru, 560103, India",
        address_details: { locality: "Adarsh Palm Retreat", city: "Bengaluru" },
      })
    ).toBe("Adarsh Palm Retreat");
    expect(
      resolve({
        address: "Phase 3 ، 560035 Bengaluru، India",
        address_details: { locality: "Adarsh Palm Retreat", city: "Bengaluru" },
      })
    ).toBe("Adarsh Palm Retreat");
  });

  it("never uses distance: two venues 36m apart must not be guessed between", () => {
    // APR Tower 1 and APR Villas really are 36 metres apart on this book. An
    // address inside the complex with nothing else to go on resolves to the
    // complex, not to whichever building happens to be nearest.
    expect(
      resolve({
        address: "Bengaluru, 560103, India",
        lat: 12.9212,
        lng: 77.6886, // right between the two APR venues
        address_details: { locality: "Adarsh Palm Retreat", city: "Bengaluru" },
      })
    ).toBe("Adarsh Palm Retreat");
  });

  it("falls back to the raw head, then null, when there is nothing else", () => {
    expect(resolve({ address: "51/3, Bengaluru, 560067, India" })).toBe("51/3");
    expect(resolve({ address: null })).toBeNull();
  });
});
