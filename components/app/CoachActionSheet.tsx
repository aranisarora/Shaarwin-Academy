"use client";

// Pending-action takeover on the coach home. If the coach has a single next
// actionable session — one that needs a "coming?" confirm within 12h, or an
// "arrived?" mark inside the window — open a bottom sheet on mount with that one
// question. Dismissible per visit (sessionStorage), but returns on the next app
// open until it's answered. Reuses the stepper's active-step buttons so the
// logic never forks. No emojis.

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { CheckIcon } from "@/components/ui/icons";
import { ComingAction, ArriveAction } from "@/components/app/ArrivalActions";

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

export function CoachActionSheet({ action }: { action: CoachAction | null }) {
  // Open on mount unless dismissed this visit. Read in a lazy initializer (not
  // an effect) so it's evaluated once without a cascading render; the server
  // renders closed (no window) and the client opens on first paint.
  const [open, setOpen] = useState(() => !wasDismissed(action));
  const [done, setDone] = useState<string | null>(null);

  if (!action) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(dismissKey(action!), "1");
    } catch {
      /* private mode — fine, it just reopens */
    }
    setOpen(false);
  }

  return (
    <Sheet open={open} onClose={dismiss} title={action.title}>
      <div className="space-y-4">
        <p className="text-fg-2">
          {action.whenLabel}
          {action.venueName ? ` · ${action.venueName}` : ""}
        </p>

        {done ? (
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
