"use client";

// Pending-action takeover on the coach home. If the coach has a single next
// actionable session — one that needs a "coming?" confirm within 12h, or an
// "arrived?" mark inside the window — open a bottom sheet on mount with that one
// question. Dismissible per visit (sessionStorage), but returns on the next app
// open until it's answered. Reuses the stepper's active-step buttons so the
// logic never forks. No emojis.
//
// It also runs the proximity check, which it did not used to. The geofence only
// ever lived on app/coach/session/[id], so a coach who answered from here — or
// who tapped the "Have you reached?" notification and never scrolled past this
// sheet — was asked to mark arrival by hand at a venue the app could see they
// were standing in. That is most of why auto-arrival had fired once in
// production against 42 manual taps.

import { useState, useSyncExternalStore, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { CheckIcon, MapPinIcon } from "@/components/ui/icons";
import { ComingAction, ArriveAction, useAutoArrival } from "@/components/app/ArrivalActions";
import { undoArrival } from "@/app/coach/session/[id]/actions";

function dismissKey(action: CoachAction) {
  return `coach-action-dismissed:${action.sessionId}:${action.phase}`;
}

/** Was this action dismissed this visit? Read-only; safe in a state initializer. */
function wasDismissed(action: CoachAction | null): boolean {
  if (!action || typeof window === "undefined") return true;
  try {
    return sessionStorage.getItem(dismissKey(action)) != null;
  } catch {
    return false;
  }
}

export type CoachAction = {
  sessionId: string;
  title: string;
  whenLabel: string;
  venueName: string | null;
  phase: "confirm" | "arrive";
  venueLat: number | null;
  venueLng: number | null;
};

/** True only after hydration. Lets a render read browser-only state (here,
 *  sessionStorage) without the client's first paint disagreeing with the
 *  server's: React uses the server snapshot for SSR *and* for hydration, then
 *  re-renders with the client one. */
const subscribeNoop = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
}

export function CoachActionSheet({ action }: { action: CoachAction | null }) {
  // The sheet must render closed on the server and on the hydration pass (both
  // render nothing), then open unless this action was dismissed this visit.
  // `hydrated` gates the sessionStorage read so that stays true.
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [autoArrived, setAutoArrived] = useState(false);
  // Separate from `autoArrived` on purpose. `autoArrived` chooses which body to
  // render and Undo clears it; `takeover` is "this sheet has something the coach
  // has not seen yet" and only an explicit dismiss clears that. Folding the two
  // together meant tapping Undo re-applied an earlier dismissal and shut the
  // sheet before the coach could read whether the undo had worked.
  const [takeover, setTakeover] = useState(false);
  const [pending, startTransition] = useTransition();

  // Every hook runs before the `!action` early return below, so the order is
  // stable whether or not there is anything to ask about.
  const autoPending = useAutoArrival({
    sessionId: action?.sessionId ?? "",
    venueLat: action?.venueLat ?? null,
    venueLng: action?.venueLng ?? null,
    active: action?.phase === "arrive" && !done && !autoArrived,
    onArrived: () => {
      setAutoArrived(true);
      setTakeover(true);
      setDone(null);
    },
    onFailed: (_iso, msg) => {
      setAutoArrived(false);
      setDone(msg);
    },
  });

  // An automatic arrival takes the sheet over even if it was dismissed this
  // visit. A silent state change with a ten-minute Undo the coach never saw
  // would be the worst of both worlds: parents told they have arrived, and no
  // way for them to notice in time to say otherwise.
  const open = takeover || (hydrated && !dismissed && !wasDismissed(action));

  if (!action) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(dismissKey(action!), "1");
    } catch {
      /* private mode — fine, it just reopens */
    }
    setDismissed(true);
    setTakeover(false);
  }

  function onUndo() {
    setAutoArrived(false);
    startTransition(async () => {
      const r = await undoArrival(action!.sessionId);
      setDone(
        r.ok
          ? "Undone — you're not marked as arrived."
          : r.error ?? "Couldn't undo. Try again."
      );
    });
  }

  const busy = pending || autoPending;

  return (
    <Sheet open={open} onClose={dismiss} title={action.title}>
      <div className="space-y-4">
        <p className="text-fg-2">
          {action.whenLabel}
          {action.venueName ? ` · ${action.venueName}` : ""}
        </p>

        {autoArrived ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-ok">
              <MapPinIcon className="h-5 w-5 shrink-0" />
              <p className="font-medium">
                You&rsquo;re at {action.venueName ?? "the venue"} — we&rsquo;ve marked you as
                arrived automatically.
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={onUndo}
              className="w-full sm:w-auto"
            >
              Undo
            </Button>
          </div>
        ) : done ? (
          <div className="flex items-center gap-2 text-ok">
            <CheckIcon className="h-5 w-5 shrink-0" />
            <p className="font-medium">{done}</p>
          </div>
        ) : action.phase === "confirm" ? (
          <>
            <p>Are you coming to this session?</p>
            <ComingAction
              sessionId={action.sessionId}
              onConfirmed={() => setDone("Confirmed — see you there.")}
              onError={(_iso, msg) => setDone(msg)}
            />
          </>
        ) : (
          <>
            <p>Have you reached {action.venueName ?? "the venue"}?</p>
            <ArriveAction
              sessionId={action.sessionId}
              venueLat={action.venueLat}
              venueLng={action.venueLng}
              onArrived={() => setDone("Marked as arrived — parents notified.")}
              onArrivedFail={(_iso, msg) => setDone(msg)}
              onLate={(msg) => setDone(msg)}
            />
          </>
        )}
      </div>
    </Sheet>
  );
}
