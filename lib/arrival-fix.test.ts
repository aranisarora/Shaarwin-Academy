// The rows this parser lets through become the distribution that sets the
// geofence width. That is the whole reason it is strict: a fence moved on numbers
// no device ever measured is worse than a fence nobody has evidence for, because
// the second one at least knows it is guessing.

import { describe, it, expect } from "vitest";
import { parseArrivalFixReport, type ArrivalFixReport } from "./arrival-fix";

const good: ArrivalFixReport = {
  sessionId: "3f1a0c7e-0000-4000-8000-000000000001",
  source: "auto",
  outcome: "fix",
  distanceM: 42,
  accuracyM: 18,
  marked: true,
};

describe("parseArrivalFixReport", () => {
  it("accepts a well-formed report unchanged", () => {
    expect(parseArrivalFixReport(good)).toEqual(good);
  });

  it("rejects anything that isn't an object", () => {
    for (const body of [null, undefined, 7, "fix", true, []]) {
      // An array is an object to `typeof`, and would otherwise sail through with
      // every field undefined.
      expect(parseArrivalFixReport(body), JSON.stringify(body) ?? "undefined").toBeNull();
    }
  });

  it("requires a session, a known source and a known outcome", () => {
    expect(parseArrivalFixReport({ ...good, sessionId: "" })).toBeNull();
    expect(parseArrivalFixReport({ ...good, sessionId: 12 })).toBeNull();
    expect(parseArrivalFixReport({ ...good, source: "wa" })).toBeNull();
    expect(parseArrivalFixReport({ ...good, outcome: "far_away" })).toBeNull();
    expect(parseArrivalFixReport({ ...good, marked: "yes" })).toBeNull();
  });

  it("keeps a distance only when a position actually came back", () => {
    // The bug this stops: a timeout carrying the last distance the client
    // happened to have in a variable, landing in the fence distribution as if a
    // device had measured it.
    const timedOut = parseArrivalFixReport({ ...good, outcome: "timeout" });
    expect(timedOut).toMatchObject({ outcome: "timeout", distanceM: null, accuracyM: null });

    const noVenue = parseArrivalFixReport({ ...good, outcome: "no_venue" });
    expect(noVenue).toMatchObject({ outcome: "no_venue", distanceM: null });
  });

  it("drops distances that aren't real measurements", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, "12", {}]) {
      expect(parseArrivalFixReport({ ...good, distanceM: bad })?.distanceM, String(bad)).toBeNull();
    }
  });

  it("rounds to whole metres, because nothing here is sub-metre honest", () => {
    expect(parseArrivalFixReport({ ...good, distanceM: 42.6, accuracyM: 17.2 })).toMatchObject({
      distanceM: 43,
      accuracyM: 17,
    });
  });

  it("allows a fix with no accuracy, since some browsers omit it", () => {
    expect(parseArrivalFixReport({ ...good, accuracyM: null })).toMatchObject({
      outcome: "fix",
      distanceM: 42,
      accuracyM: null,
    });
  });

  it("accepts every outcome the client can produce", () => {
    // Kept in step with FixFailure in lib/location.ts plus the two outcomes the
    // caller adds ("fix", "no_venue"). A new failure reason that isn't listed
    // here would be silently dropped by the route instead of recorded.
    for (const outcome of ["fix", "denied", "timeout", "unavailable", "unsupported", "no_venue"]) {
      expect(parseArrivalFixReport({ ...good, outcome }), outcome).not.toBeNull();
    }
  });
});
