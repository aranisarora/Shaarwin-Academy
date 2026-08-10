"use client";

/**
 * Location, from the browser's side of the wire. The distance maths is
 * lib/geo.ts; who gets asked for the permission is lib/location-prompt.ts.
 *
 * Two things here are the reason auto-arrival had fired once in production:
 *
 *   • Nothing ever asked for the permission. `getCurrentPosition` was the first
 *     and only mention of location a coach ever saw, buried inside the tap that
 *     marks arrival — so 37 of 42 manual arrivals recorded no fix at all.
 *     `locationState()` exists so the app can know where it stands *before*
 *     asking, which is what makes a real prompt possible.
 *
 *   • The one request we did make was the most demanding one available:
 *     `{ enableHighAccuracy: true, timeout: 10000 }`. That is a GPS lock, asked
 *     for indoors, in a sports hall, on a mid-range Android, in ten seconds.
 *     `locationFix()` tries a cheap cached fix first and only escalates if it
 *     has to — against a 150 m fence a two-minute-old coarse fix is plenty, and
 *     it usually lands instantly.
 *
 * Failures are typed rather than collapsed to null. `resolveDistance()` used to
 * end `() => resolve(null)` — denied, timed out and unavailable were one value,
 * which is precisely why 88% of arrivals having no fix was invisible for months.
 */

/**
 * Where location stands on this device right now, without asking for it.
 *
 * Mirrors PushState's job in lib/push.ts: four separate, honest answers where
 * there used to be silence. `unsupported` is genuinely no geolocation at all —
 * not "the fix failed", which is a LocationFix failure and a different fact.
 */
export type LocationState = "granted" | "prompt" | "denied" | "unsupported";

/** Why a fix didn't happen. GeolocationPositionError.code, named. */
export type FixFailure = "denied" | "unavailable" | "timeout" | "unsupported";

export type LocationFix =
  | { ok: true; lat: number; lng: number; accuracyM: number | null }
  | { ok: false; reason: FixFailure };

/**
 * A coarse, possibly-cached fix. Two minutes old is fine against a 150 m fence
 * and very often returns before the coach's thumb has left the button.
 */
const CHEAP: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 120000,
  timeout: 4000,
};

/** The demanding one, used only when the cheap fix couldn't answer at all. */
const PRECISE: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15000,
};

function supported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.geolocation);
}

/**
 * Where the geolocation permission stands. **Never prompts.**
 *
 * `navigator.permissions.query` is the whole point: calling
 * `getCurrentPosition` to discover the state *is* the prompt, and spending the
 * one permission ask an origin gets in order to find out whether we needed to
 * ask is the mistake this function exists to avoid. Chrome, Firefox and Safari
 * 16+ support the query; where it is missing we assume "prompt", which is the
 * safe direction — it means a coach on an older browser gets asked properly
 * instead of silently never being asked.
 */
export async function locationState(): Promise<LocationState> {
  if (!supported()) return "unsupported";
  if (!navigator.permissions?.query) return "prompt";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    // PermissionState is exactly "granted" | "prompt" | "denied".
    return status.state;
  } catch {
    // Some browsers throw on unknown descriptor names rather than resolving.
    return "prompt";
  }
}

/**
 * One `getCurrentPosition` call as a promise that never rejects.
 *
 * `GeolocationPositionError.code` is the fact worth keeping: 1 is a refusal and
 * will not fix itself, 2 and 3 are this-attempt-failed and are worth another go
 * with different options.
 */
function once(options: PositionOptions): Promise<LocationFix> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          // Metres, 95% confidence, and never null per spec — but it is a
          // number that some browsers have been known to omit, so this stays
          // defensive. Recorded because a 500 m distance with 800 m accuracy is
          // a coach standing in the hall with a bad fix, and that is not the
          // same fact as a coach who is 500 m away.
          accuracyM:
            typeof pos.coords.accuracy === "number" ? Math.round(pos.coords.accuracy) : null,
        }),
      (err) =>
        resolve({
          ok: false,
          reason:
            err.code === err.PERMISSION_DENIED
              ? "denied"
              : err.code === err.TIMEOUT
                ? "timeout"
                : "unavailable",
        }),
      options
    );
  });
}

/**
 * A position, cheaply if possible. Never rejects, never blocks longer than the
 * two timeouts put together (~19s worst case, and only when the first attempt
 * genuinely could not answer).
 *
 * Escalation is deliberately not attempted after a refusal: `denied` is a
 * settled answer, and asking the same stack again changes nothing except how
 * long the coach waits for a button that was never going to work.
 *
 * Calling this is what triggers the browser's permission dialog when the state
 * is "prompt" — so it must only ever run from a click handler, or from a path
 * where the permission is already granted.
 */
export async function locationFix(): Promise<LocationFix> {
  if (!supported()) return { ok: false, reason: "unsupported" };
  const cheap = await once(CHEAP);
  if (cheap.ok || cheap.reason === "denied") return cheap;
  return once(PRECISE);
}

/**
 * Ask for location, from a user gesture. The one prompting path — the analogue
 * of `enablePush()`, and it has the same rule: called on mount it is either
 * ignored by the browser or, worse, spends the one ask the origin gets on
 * someone who wasn't looking at the screen.
 *
 * Returns where the permission ended up, so the caller can stop asking. A fix
 * that fails for any reason other than refusal still leaves the permission
 * granted, and re-reading it is what tells those two apart.
 *
 * Deliberately the cheap attempt only, with no escalation. What this call is for
 * is consent, not coordinates — the proximity check moments later is what needs a
 * usable position, and it has `locationFix()` for that. Escalating here would
 * mean a coach who granted the permission on a phone that then failed to get a
 * lock watches a spinner for nineteen seconds after already saying yes.
 */
export async function requestLocation(): Promise<LocationState> {
  if (!supported()) return "unsupported";
  const fix = await once(CHEAP);
  if (fix.ok) return "granted";
  // A timeout or an unavailable position says nothing about the permission —
  // ask the Permissions API rather than guessing from the failure.
  return fix.reason === "denied" ? "denied" : locationState();
}
