"use client";

// The two active arrival questions — "Yes, I'm coming" and "I've arrived /
// Running late" — as standalone buttons, shared by the session-page stepper
// (SessionArrival) and the coach-home takeover sheet (CoachActionSheet) so the
// logic never forks. Each drives the parent's state through callbacks and owns
// its own pending transition.
//
// The proximity check lives here too, for the same reason. It used to run only
// in SessionArrival's own effect, so a coach who answered from the coach-home
// sheet — or who was sent there by the "Have you reached?" notification and
// never opened the session page — got no geofence at all. One implementation,
// two mounts: useAutoArrival() below.

import { useEffect, useRef, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { confirmComing, markArrived, markRunningLate } from "@/app/coach/session/[id]/actions";
import { GEOFENCE_M, haversineMeters } from "@/lib/geo";
import { locationFix, locationState } from "@/lib/location";
import { reportArrivalFix, type ArrivalFixOutcome } from "@/lib/arrival-fix";

/** What the device could work out about where it is, relative to the venue. */
type Proximity = {
  outcome: ArrivalFixOutcome;
  /** Metres to the venue, only when `outcome` is "fix". */
  distanceM: number | null;
  /** Claimed accuracy of that fix, in metres. */
  accuracyM: number | null;
};

/**
 * Distance to the venue, and — the part that was missing — *why* not, when not.
 *
 * This function used to end `() => resolve(null)`. Permission denied, a timeout
 * and a position the stack simply could not produce all came back as the same
 * value, which is why 37 of 42 manual arrivals recording no fix at all went
 * unnoticed for months. `GeolocationPositionError.code` distinguishes them and
 * lib/location.ts names them.
 *
 * Calling this triggers the browser's permission dialog when the state is
 * "prompt", so it belongs in a click handler or behind an already-granted
 * permission — never in a bare mount effect.
 */
async function measureProximity(
  venueLat: number | null,
  venueLng: number | null
): Promise<Proximity> {
  // Nothing to measure against. Worth recording as its own outcome rather than
  // as a failed fix: it is a data problem, not a device problem, and conflating
  // them is how "the geofence doesn't work" stays unexplained.
  if (venueLat == null || venueLng == null) {
    return { outcome: "no_venue", distanceM: null, accuracyM: null };
  }

  const fix = await locationFix();
  if (!fix.ok) return { outcome: fix.reason, distanceM: null, accuracyM: null };

  return {
    outcome: "fix",
    distanceM: Math.round(haversineMeters(fix.lat, fix.lng, venueLat, venueLng)),
    accuracyM: fix.accuracyM,
  };
}

/** Inside the fence, and sure enough about it to act without being asked. */
function insideFence(p: Proximity): boolean {
  return p.outcome === "fix" && p.distanceM !== null && p.distanceM <= GEOFENCE_M;
}

/**
 * Geofenced auto-arrival, wherever a coach can mark arrival inside the window.
 *
 * Mounted by the session-page stepper and by the coach-home sheet. Exactly one
 * of those is on screen at a time, which matters: `coach_mark_arrival` inserts a
 * parent notification on every call, so two live copies of this would tell every
 * booked parent twice.
 *
 * The permission is *read* before anything is requested. The old version called
 * `getCurrentPosition` straight from a mount effect, which is a permission
 * dialog appearing on page load with no gesture behind it — the browser may
 * suppress it outright, and if it doesn't, it spends the one ask the origin gets
 * on a coach who was looking at their schedule. Asking is <LocationPrompt />'s
 * job. This only acts on a permission already granted, where a fix costs no UI
 * and no interruption.
 */
export function useAutoArrival({
  sessionId,
  venueLat,
  venueLng,
  active,
  onArrived,
  onFailed,
}: {
  sessionId: string;
  venueLat: number | null;
  venueLng: number | null;
  /** In the arrival window, and not marked yet. */
  active: boolean;
  /** Optimistically mark arrived. `distanceM` is how far off the fix was. */
  onArrived: (optimisticIso: string, distanceM: number | null) => void;
  /** The server refused it — roll the optimistic mark back. */
  onFailed: (optimisticIso: string, message: string) => void;
}): boolean {
  const [pending, start] = useTransition();
  const tried = useRef(false);
  // Callbacks are re-created on every parent render; holding them in a ref keeps
  // them out of the effect's deps, so the check still runs exactly once.
  const cbs = useRef({ onArrived, onFailed });
  // `active` as it stands *now*, not as it stood when the effect ran. A fix can
  // take up to 19s if the cheap attempt has to escalate, and a coach who taps
  // "I've arrived" inside that window would otherwise be marked twice — and
  // coach_mark_arrival inserts a parent notification per call, so every booked
  // parent would hear about it twice.
  const activeNow = useRef(active);
  useEffect(() => {
    cbs.current = { onArrived, onFailed };
    activeNow.current = active;
  });

  useEffect(() => {
    if (tried.current || !active) return;
    tried.current = true;

    let alive = true;
    void (async () => {
      // Not granted means not now: no fix, and no telemetry row either. A coach
      // who has never been asked would otherwise write one of these on every
      // page open, and drown the rows that say something.
      if ((await locationState()) !== "granted") return;

      const p = await measureProximity(venueLat, venueLng);
      if (!alive) return;

      // Two reasons not to act, one row either way — the measurement is worth
      // recording whether or not anything came of it:
      //
      //   • arrival got marked while we were measuring, by a tap, by WhatsApp or
      //     by the notification's own button;
      //   • the fix landed outside the fence, or never landed at all. This is the
      //     row that was never written, and a fix at 600 m, a timeout in a sports
      //     hall and a venue with no coordinates are exactly the three things
      //     that have to be told apart before the fence width can be argued
      //     about.
      if (!activeNow.current || !insideFence(p)) {
        reportArrivalFix({
          sessionId,
          source: "auto",
          outcome: p.outcome,
          distanceM: p.distanceM,
          accuracyM: p.accuracyM,
          marked: false,
        });
        return;
      }

      const optimistic = new Date().toISOString();
      cbs.current.onArrived(optimistic, p.distanceM);
      start(async () => {
        const r = await markArrived(sessionId, { source: "auto", distanceM: p.distanceM });
        if (!r.ok) cbs.current.onFailed(optimistic, r.error ?? "Couldn't send. Try again.");
        reportArrivalFix({
          sessionId,
          source: "auto",
          outcome: p.outcome,
          distanceM: p.distanceM,
          accuracyM: p.accuracyM,
          marked: r.ok,
        });
      });
    })();

    return () => {
      alive = false;
    };
  }, [active, sessionId, venueLat, venueLng]);

  return pending;
}

/** Step 1 active state — the single "Yes, I'm coming" button. */
export function ComingAction({
  sessionId,
  onConfirmed,
  onError,
}: {
  sessionId: string;
  onConfirmed: (optimisticIso: string) => void;
  onError: (optimisticIso: string, message: string) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={() => {
        const optimistic = new Date().toISOString();
        onConfirmed(optimistic);
        start(async () => {
          const r = await confirmComing(sessionId);
          if (!r.ok) onError(optimistic, r.error ?? "Couldn't confirm. Try again.");
        });
      }}
    >
      Yes, I&rsquo;m coming
    </Button>
  );
}

/** Step 2 active state — "I've arrived" (with a best-effort GPS fix) + "Running late". */
export function ArriveAction({
  sessionId,
  venueLat,
  venueLng,
  onArrived,
  onArrivedFail,
  onLate,
}: {
  sessionId: string;
  venueLat: number | null;
  venueLng: number | null;
  /** Optimistically mark arrived; the arg is the timestamp used to roll back on failure. */
  onArrived: (optimisticIso: string) => void;
  onArrivedFail: (optimisticIso: string, message: string) => void;
  onLate: (message: string) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row">
      <Button
        size="lg"
        className="w-full sm:flex-1"
        disabled={pending}
        onClick={() => {
          const optimistic = new Date().toISOString();
          onArrived(optimistic);
          // The fix resolves in the background — a tap is never blocked on GPS.
          // The coach has already said they are here, so this is only ever about
          // recording how far off the device thought they were, which is the
          // measurement the fence width has to come from. It is also the one
          // path where a "prompt" permission is worth spending: the tap is a
          // gesture, and asking for location at the moment someone says "I've
          // arrived" is coherent rather than out of nowhere.
          void measureProximity(venueLat, venueLng).then((p) => {
            start(async () => {
              const r = await markArrived(sessionId, { source: "tap", distanceM: p.distanceM });
              if (!r.ok) onArrivedFail(optimistic, r.error ?? "Couldn't send. Try again.");
              reportArrivalFix({
                sessionId,
                source: "tap",
                outcome: p.outcome,
                distanceM: p.distanceM,
                accuracyM: p.accuracyM,
                marked: r.ok,
              });
            });
          });
        }}
      >
        I&rsquo;ve arrived
      </Button>
      <Button
        variant="ghost"
        size="lg"
        className="w-full sm:w-auto"
        disabled={pending}
        onClick={() => {
          start(async () => {
            const r = await markRunningLate(sessionId);
            onLate(
              r.ok
                ? "Sent — parents and the founder know you're running late."
                : r.error ?? "Couldn't send. Try again."
            );
          });
        }}
      >
        Running late
      </Button>
    </div>
  );
}
