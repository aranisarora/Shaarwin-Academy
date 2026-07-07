"use client";

import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import {
  getRescheduleTargets,
  rescheduleGroupBooking,
  getPrivateRescheduleSlots,
  previewPrivateReschedule,
  confirmPrivateReschedule,
  type RescheduleTarget,
} from "@/app/app/schedule/actions";
import type { MyBooking } from "@/lib/booking";

function fmt(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function RescheduleSheet({
  booking,
  onClose,
  onDone,
}: {
  booking: MyBooking | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [targets, setTargets] = useState<RescheduleTarget[] | null>(null);
  const [slots, setSlots] = useState<{ starts_at: string; coach_count: number }[] | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ coachName: string | null; changed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isFree = booking
    ? new Date(booking.session.starts_at).getTime() - Date.now() >= 24 * 3600000
    : true;

  useEffect(() => {
    if (!booking) return;
    setTargets(null);
    setSlots(null);
    setPicked(null);
    setPreview(null);
    setError(null);
    setSuccess(null);
    const isPriv = booking.session.isPrivate;
    setIsPrivate(isPriv);
    startTransition(async () => {
      if (isPriv) {
        setSlots(await getPrivateRescheduleSlots(booking.session.id));
      } else {
        const r = await getRescheduleTargets(booking.id);
        setTargets(r.targets);
        if (r.error) setError(r.error);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id]);

  function pickGroup(target: RescheduleTarget) {
    if (!booking) return;
    setError(null);
    startTransition(async () => {
      const r = await rescheduleGroupBooking(booking.id, target.sessionId);
      if (r.ok) {
        setSuccess(fmt(target.starts_at));
      } else {
        setError(r.error ?? null);
        // refresh the list — the slot may have just filled
        const refreshed = await getRescheduleTargets(booking.id);
        setTargets(refreshed.targets);
      }
    });
  }

  function pickPrivate(startsAt: string) {
    if (!booking) return;
    setPicked(startsAt);
    setPreview(null);
    setError(null);
    startTransition(async () => {
      const r = await previewPrivateReschedule(booking.session.id, startsAt);
      if (!r.ok) {
        setError(r.error ?? null);
        setPicked(null);
        return;
      }
      setPreview({ coachName: r.coachName ?? null, changed: r.coachChanged ?? false });
    });
  }

  function confirmPrivate() {
    if (!booking || !picked) return;
    startTransition(async () => {
      const r = await confirmPrivateReschedule(booking.session.id, picked);
      if (r.ok) setSuccess(fmt(picked));
      else setError(r.error ?? null);
    });
  }

  return (
    <Sheet open={booking !== null} onClose={onClose} title="Reschedule">
      {booking && (
        <div className="space-y-5">
          {success ? (
            <div className="py-6 text-center">
              <span aria-hidden className="ball-drop mx-auto mb-3 block h-4 w-4 rounded-full bg-ember" />
              <p className="font-medium">Rescheduled to {success}.</p>
              <p className="mt-1 text-sm text-fg-2">
                Your old calendar entry no longer applies — the new .ics is in your schedule.
              </p>
              <Button className="mt-5" onClick={onDone}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm text-fg-2">Moving</p>
                <p className="tnum font-medium">
                  {fmt(booking.session.starts_at)} — {booking.session.classTitle}
                </p>
                <p className="mt-1 text-xs text-fg-2">
                  {isFree
                    ? "Free — more than 24 hours before the start."
                    : "Inside 24 hours: this uses your session / minutes."}
                </p>
              </div>

              {pending && targets === null && slots === null && (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              )}

              {!isPrivate && targets && (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {targets.length === 0 && (
                    <p className="py-4 text-sm text-fg-2">
                      No equivalent sessions with seats in the next two weeks.
                    </p>
                  )}
                  {targets.map((t) => (
                    <button
                      key={t.sessionId}
                      disabled={pending}
                      onClick={() => pickGroup(t)}
                      className="flex w-full items-center justify-between gap-3 rounded-[8px] border border-line px-3.5 py-3 text-left hover:border-ember"
                    >
                      <div>
                        <p className="tnum text-sm font-medium">{fmt(t.starts_at)}</p>
                        <p className="text-xs text-fg-2">
                          {t.classTitle}
                          {t.venueName ? ` — ${t.venueName}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {t.sameClass && <Badge tone="ember">Same class</Badge>}
                        <span className="tnum text-xs text-fg-2">{t.seatsLeft} left</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {isPrivate && slots && !preview && (
                <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {slots.length === 0 && (
                    <p className="col-span-2 py-4 text-sm text-fg-2">
                      No servable times in the next two weeks.
                    </p>
                  )}
                  {slots.slice(0, 60).map((s) => (
                    <button
                      key={s.starts_at}
                      disabled={pending}
                      onClick={() => pickPrivate(s.starts_at)}
                      className="tnum min-h-11 rounded-[8px] border border-line px-2 text-sm hover:border-ember"
                    >
                      {fmt(s.starts_at)}
                    </button>
                  ))}
                </div>
              )}

              {isPrivate && preview && picked && (
                <div className="space-y-4 rounded-[12px] border border-line bg-surface p-4">
                  <p className="tnum font-medium">{fmt(picked)}</p>
                  {preview.changed ? (
                    <p className="text-sm">
                      {booking.session.coachName ?? "Your coach"} isn&apos;t free then.{" "}
                      <span className="font-medium">
                        {preview.coachName ?? "Another coach"} can take it
                      </span>{" "}
                      — or pick another time.
                    </p>
                  ) : (
                    <p className="text-sm text-fg-2">
                      Same coach{preview.coachName ? ` — ${preview.coachName}` : ""}.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => { setPicked(null); setPreview(null); }}>
                      Pick another
                    </Button>
                    <Button onClick={confirmPrivate} disabled={pending} className="flex-1">
                      {pending ? <Spinner /> : "Confirm"}
                    </Button>
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-err">{error}</p>}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
