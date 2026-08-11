"use client";

// The two active arrival questions — "Yes, I'm coming" and "I've arrived /
// Running late" — as standalone buttons, shared by the session-page stepper
// (SessionArrival) and the coach-home takeover sheet (CoachActionSheet) so the
// logic never forks. Each drives the parent's state through callbacks and owns
// its own pending transition.
//
// There is no geofence here any more. Auto-arrival was built to save the coach
// the tap, and measured over a day in production it marked exactly one session
// while the app was open — because a coach with the app open can just as easily
// press the button. The case worth solving was always the app being *closed*,
// and the web cannot do that at all: geolocation is unavailable to a service
// worker, so nothing runs at the venue unless someone opens the page. That case
// is already covered by the "I've arrived" button on the push notification
// (app/api/push-action/route.ts), which costs one tap from the lock screen and
// needs no permission. So the fence, the distance telemetry and the location
// prompt are gone, and arrival is a tap in one of three places — the app, the
// notification tray, or WhatsApp — each recorded as its own source.

import { useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { confirmComing, markArrived, markRunningLate } from "@/app/coach/session/[id]/actions";

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

/** Step 2 active state — "I've arrived" + "Running late". */
export function ArriveAction({
  sessionId,
  onArrived,
  onArrivedFail,
  onLate,
}: {
  sessionId: string;
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
          // Straight to the RPC. This used to wait on a GPS fix before sending,
          // purely to record a distance for tuning the fence — so a coach who
          // had already said "I'm here" sat behind a location lookup that
          // changed nothing about the outcome.
          start(async () => {
            const r = await markArrived(sessionId);
            if (!r.ok) onArrivedFail(optimistic, r.error ?? "Couldn't send. Try again.");
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
