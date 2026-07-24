"use client";

// The two active arrival questions — "Yes, I'm coming" and "I've arrived /
// Running late" — as standalone buttons, shared by the session-page stepper
// (SessionArrival) and the coach-home takeover sheet (CoachActionSheet) so the
// logic never forks. Each drives the parent's state through callbacks and owns
// its own pending transition.

import { useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { confirmComing, markArrived, markRunningLate } from "@/app/coach/session/[id]/actions";
import { haversineMeters } from "@/lib/geo";

/**
 * Best-effort distance (metres) from the device to the venue, resolving to null
 * on any failure — no coords, no geolocation, permission denied, or timeout. It
 * never rejects and never blocks longer than `timeoutMs`.
 */
export function resolveDistance(
  venueLat: number | null,
  venueLng: number | null,
  timeoutMs: number
): Promise<number | null> {
  if (
    venueLat == null ||
    venueLng == null ||
    typeof navigator === "undefined" ||
    !navigator.geolocation
  ) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve(Math.round(haversineMeters(pos.coords.latitude, pos.coords.longitude, venueLat, venueLng))),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs }
    );
  });
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
          // Resolve the fix in the background (≤3s) — never block the tap on GPS.
          resolveDistance(venueLat, venueLng, 3000).then((distanceM) => {
            start(async () => {
              const r = await markArrived(sessionId, { source: "tap", distanceM });
              if (!r.ok) onArrivedFail(optimistic, r.error ?? "Couldn't send. Try again.");
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
