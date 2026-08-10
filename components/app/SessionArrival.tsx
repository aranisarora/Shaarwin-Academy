"use client";

// Two-step arrival stepper on the coach's session page — one question at a time.
// Step 1 "Coming?" is always available in the window; step 2 "Arrived" unlocks
// an hour before start. Marking arrival implies coming (mirrors the RPC). When
// the venue has coordinates and the coach has already granted location, opening
// the page inside the window takes one fix and auto-marks arrival within the
// fence, with an Undo that beats the delayed parent notification. It no longer
// asks for the permission from here — <LocationPrompt /> does that, from a tap.
// No emojis — icons + design tokens only.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { CheckIcon, LockIcon, MapPinIcon } from "@/components/ui/icons";
import { ComingAction, ArriveAction, useAutoArrival } from "@/components/app/ArrivalActions";
import { undoArrival } from "@/app/coach/session/[id]/actions";
import { formatClock, nowMs } from "@/lib/academy-time";

const UNDO_WINDOW_MS = 10 * 60000;

export function SessionArrival({
  sessionId,
  startsAt,
  endsAt,
  coachArrivedAt,
  coachConfirmedAt = null,
  venueLat = null,
  venueLng = null,
  venueName = null,
}: {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  coachArrivedAt: string | null;
  coachConfirmedAt?: string | null;
  venueLat?: number | null;
  venueLng?: number | null;
  venueName?: string | null;
}) {
  const [arrivedAt, setArrivedAt] = useState<string | null>(coachArrivedAt);
  const [arrivedAuto, setArrivedAuto] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(coachConfirmedAt);
  const [lateMsg, setLateMsg] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const startMs = new Date(startsAt).getTime();
  const unlockMs = startMs - 60 * 60000;
  const endMs = new Date(endsAt).getTime();
  // Step 2 is available from an hour before start until the session ends.
  const open = nowMs() >= unlockMs && nowMs() <= endMs;
  const beforeWindow = nowMs() < unlockMs;
  const comingDone = confirmedAt ?? arrivedAt; // arrived implies coming
  const canUndo = arrivedAt != null && nowMs() - new Date(arrivedAt).getTime() < UNDO_WINDOW_MS;

  // Geofenced auto-arrival, shared with the coach-home sheet so the two can't
  // disagree about how close counts. Parents are notified on a 2-minute delay
  // (server-side) so Undo beats delivery.
  const autoPending = useAutoArrival({
    sessionId,
    venueLat,
    venueLng,
    active: open && !arrivedAt,
    onArrived: (iso) => {
      setArrivedAt(iso);
      setArrivedAuto(true);
      setConfirmedAt((c) => c ?? iso);
    },
    onFailed: (iso, msg) => {
      setArrivedAt((cur) => (cur === iso ? null : cur));
      setArrivedAuto(false);
      setMessage(msg);
    },
  });
  const busy = pending || autoPending;

  function onUndo() {
    setMessage(null);
    const prev = arrivedAt;
    setArrivedAt(null);
    setArrivedAuto(false);
    startTransition(async () => {
      const r = await undoArrival(sessionId);
      if (!r.ok) {
        setArrivedAt(prev);
        setMessage(r.error ?? "Couldn't undo. Try again.");
      }
    });
  }

  return (
    <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-4">
      {/* ── Step 1 — Coming? ── */}
      <div>
        <p className="label mb-2">Step 1 · Coming?</p>
        {comingDone ? (
          <div className="flex items-center gap-2 text-ok">
            <CheckIcon className="h-5 w-5 shrink-0" />
            <p className="font-medium">Confirmed at {formatClock(comingDone)}</p>
          </div>
        ) : (
          <ComingAction
            sessionId={sessionId}
            onConfirmed={(iso) => setConfirmedAt(iso)}
            onError={(iso, msg) => {
              setConfirmedAt((c) => (c === iso ? null : c));
              setMessage(msg);
            }}
          />
        )}
      </div>

      <div className="h-px bg-line" />

      {/* ── Step 2 — Arrived ── */}
      <div>
        <p className="label mb-2">Step 2 · Arrived</p>
        {arrivedAt ? (
          arrivedAuto ? (
            <div className="space-y-2.5">
              <div className="flex items-start gap-2 text-ok">
                <MapPinIcon className="h-5 w-5 shrink-0" />
                <p className="font-medium">
                  You&rsquo;re at {venueName ?? "the venue"} — we&rsquo;ve marked you as arrived
                  automatically.
                </p>
              </div>
              {canUndo && (
                <Button variant="ghost" disabled={busy} onClick={onUndo} className="w-full sm:w-auto">
                  Undo
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-ok">
                <CheckIcon className="h-5 w-5 shrink-0" />
                <p className="font-medium">Arrived at {formatClock(arrivedAt)} · parents notified</p>
              </div>
              {canUndo && (
                <Button variant="ghost" disabled={busy} onClick={onUndo} className="w-full sm:w-auto">
                  Undo
                </Button>
              )}
            </div>
          )
        ) : open ? (
          <div className="space-y-2">
            <ArriveAction
              sessionId={sessionId}
              venueLat={venueLat}
              venueLng={venueLng}
              onArrived={(iso) => {
                setArrivedAt(iso);
                setArrivedAuto(false);
                setConfirmedAt((c) => c ?? iso);
              }}
              onArrivedFail={(iso, msg) => {
                setArrivedAt((cur) => (cur === iso ? null : cur));
                setMessage(msg);
              }}
              onLate={setLateMsg}
            />
            {lateMsg && <p className="text-sm text-fg-2">{lateMsg}</p>}
          </div>
        ) : beforeWindow ? (
          <div className="flex items-center gap-2 text-fg-2">
            <LockIcon className="h-5 w-5 shrink-0" />
            <p className="text-sm">Unlocks {formatClock(unlockMs)}</p>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-fg-2">
            <LockIcon className="h-5 w-5 shrink-0" />
            <p className="text-sm">The arrival window has closed.</p>
          </div>
        )}
      </div>

      {message && <p className="text-sm text-fg-2">{message}</p>}
    </div>
  );
}
