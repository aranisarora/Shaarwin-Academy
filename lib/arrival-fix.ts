// What happened when the app tried to work out whether the coach is at the
// venue — recorded on every attempt, not just the ones that mark arrival.
//
// This is the data that decides the fence width, and it did not exist. Production
// on 2026-08-10: 42 arrivals marked by tap, 5 of them carrying a distance, 37
// carrying nothing at all. `coach_arrival_distance_m` is only written when
// arrival is actually *marked*, so a coach standing 600 m away, and a coach whose
// GPS timed out in a sports hall, and a coach who refused the permission in 2025
// all left the same trace: none. Widening the fence off five numbers would be
// guessing; this is how the numbers accumulate.
//
// It writes to `audit_log`, which already exists — no migration, and deliberately
// so: PR B is editing supabase/schema.sql in parallel and a migration must be
// paired with a hand-edit of that file in the same commit (.githooks/pre-commit
// enforces it). `audit_log` has an actor, an entity, and a jsonb meta, which is
// exactly the shape of this fact.

/** How the attempt ended. Not a boolean, because the four failures differ. */
export type ArrivalFixOutcome =
  /** A position came back, and `distanceM` is meaningful. */
  | "fix"
  /** PERMISSION_DENIED. Only browser site settings can undo it. */
  | "denied"
  /** TIMEOUT — the fix was still being worked on when we gave up. */
  | "timeout"
  /** POSITION_UNAVAILABLE — the stack could not produce one. */
  | "unavailable"
  /** No `navigator.geolocation` on this device at all. */
  | "unsupported"
  /** The venue has no coordinates, so there was nothing to measure against. */
  | "no_venue";

const OUTCOMES: readonly ArrivalFixOutcome[] = [
  "fix",
  "denied",
  "timeout",
  "unavailable",
  "unsupported",
  "no_venue",
];

export type ArrivalFixReport = {
  sessionId: string;
  /** Which surface tried: the silent proximity check, or a coach's tap. */
  source: "auto" | "tap";
  outcome: ArrivalFixOutcome;
  /** Metres to the venue. Null unless `outcome` is "fix". */
  distanceM: number | null;
  /** Metres of claimed accuracy on the fix — the number that tells a bad fix
   *  from a distant coach. Null unless "fix", and possibly null even then. */
  accuracyM: number | null;
  /** Did this attempt actually mark the session as arrived? */
  marked: boolean;
};

/** A non-negative integer, or null. Rejects NaN, Infinity and negatives. */
function metres(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/**
 * Validate an untrusted body into a report, or null.
 *
 * Shared by the client that sends it and the route that stores it, so the two
 * cannot drift into disagreeing about the shape. Anything unrecognised becomes
 * null rather than being coerced — a row of made-up numbers in the distribution
 * that sets the fence is worse than a missing row.
 */
export function parseArrivalFixReport(body: unknown): ArrivalFixReport | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (typeof b.sessionId !== "string" || b.sessionId === "") return null;
  if (b.source !== "auto" && b.source !== "tap") return null;
  if (typeof b.outcome !== "string") return null;
  if (!OUTCOMES.includes(b.outcome as ArrivalFixOutcome)) return null;
  if (typeof b.marked !== "boolean") return null;

  const outcome = b.outcome as ArrivalFixOutcome;
  const distanceM = metres(b.distanceM);
  const accuracyM = metres(b.accuracyM);

  return {
    sessionId: b.sessionId,
    source: b.source,
    outcome,
    // A distance is only a fact when a position came back. Keeping one against
    // "timeout" would put a number into the fence distribution that no device
    // ever measured.
    distanceM: outcome === "fix" ? distanceM : null,
    accuracyM: outcome === "fix" ? accuracyM : null,
    marked: b.marked,
  };
}

/**
 * Send one attempt's outcome. Fire-and-forget by design: this is telemetry
 * behind a coach's arrival, and it must never delay the tap, never surface an
 * error, and never be the reason an arrival fails to send.
 */
export function reportArrivalFix(report: ArrivalFixReport): void {
  try {
    void fetch("/api/arrival-fix", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      // Survives the page being navigated away from — a coach who taps
      // "I've arrived" and immediately backgrounds the app still leaves the row.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // No fetch, no network, blocked by an extension. Nothing to do and nothing
    // worth telling the coach.
  }
}
