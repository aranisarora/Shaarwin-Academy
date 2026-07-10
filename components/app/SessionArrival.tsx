"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { markArrived, markRunningLate } from "@/app/coach/session/[id]/actions";
import { ACADEMY_TZ, nowMs } from "@/lib/academy-time";

function fmtClock(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: ACADEMY_TZ,
  }).format(new Date(iso));
}

export function SessionArrival({
  sessionId,
  startsAt,
  endsAt,
  coachArrivedAt,
}: {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  coachArrivedAt: string | null;
}) {
  const [arrivedAt, setArrivedAt] = useState<string | null>(coachArrivedAt);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Available from an hour before the session until it ends. Mirrors the
  // render-time window check in SessionRoster.
  const open =
    nowMs() >= new Date(startsAt).getTime() - 60 * 60000 &&
    nowMs() <= new Date(endsAt).getTime();

  if (arrivedAt) {
    return (
      <div className="rounded-[12px] border border-ok bg-ok/10 px-4 py-3.5">
        <p className="font-semibold text-ok">✓ You’re marked as arrived</p>
        <p className="text-sm text-fg-2">
          At {fmtClock(arrivedAt)} — the parents and the founder have been told.
        </p>
      </div>
    );
  }

  function onArrived() {
    setMessage(null);
    const optimistic = new Date().toISOString();
    setArrivedAt(optimistic);
    startTransition(async () => {
      const r = await markArrived(sessionId);
      if (!r.ok) {
        setArrivedAt(null);
        setMessage(r.error ?? "Couldn’t send. Try again.");
      }
    });
  }

  function onLate() {
    setMessage(null);
    startTransition(async () => {
      const r = await markRunningLate(sessionId);
      setMessage(
        r.ok
          ? "Sent — parents and the founder know you’re running late."
          : r.error ?? "Couldn’t send. Try again."
      );
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          disabled={!open || pending}
          onClick={onArrived}
          className="w-full text-lg sm:flex-1"
        >
          ✓ I’ve arrived
        </Button>
        <Button
          variant="ghost"
          size="lg"
          disabled={!open || pending}
          onClick={onLate}
          className="w-full sm:w-auto"
        >
          ⏰ Running late
        </Button>
      </div>
      <p className="text-sm text-fg-2">
        {open
          ? "Tap “I’ve arrived” when you reach the venue — the parents and the founder are told straight away."
          : "You can mark your arrival from an hour before the session starts."}
      </p>
      {message && <p className="text-sm text-fg-2">{message}</p>}
    </div>
  );
}
