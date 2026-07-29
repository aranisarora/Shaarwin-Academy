"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { cancelBooking } from "@/app/app/book/actions";
import { cancelPrivateSeries, cancelSeries } from "@/app/app/schedule/actions";
// Only needed once a user taps "Reschedule" — keep it out of the page bundle.
const RescheduleSheet = dynamic(
  () => import("@/components/app/RescheduleSheet").then((m) => m.RescheduleSheet),
  { ssr: false }
);
import { AddressDisplay } from "@/components/app/AddressDisplay";
import type { MyBooking } from "@/lib/booking";
import { formatSessionDate, nowMs } from "@/lib/academy-time";

const fmt = formatSessionDate;

function BookingCard({
  booking,
  onOpen,
}: {
  booking: MyBooking;
  onOpen?: (b: MyBooking) => void;
}) {
  return (
    <button
      onClick={onOpen ? () => onOpen(booking) : undefined}
      className={`flex w-full items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3.5 text-left ${
        onOpen ? "hover:border-ember" : "cursor-default"
      }`}
    >
      <div>
        <p className="tnum font-medium">{fmt(booking.session.starts_at)}</p>
        <p className="text-sm text-fg-2">
          {booking.session.classTitle}
          {booking.session.venueName ? ` — ${booking.session.venueName}` : " — at your address"}
          {booking.playerName ? ` · ${booking.playerName}` : ""}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {booking.session.isPrivate && <Badge>Private</Badge>}
        {(booking.seriesId || booking.privateSeriesId) && <Badge tone="ember">Weekly</Badge>}
        {booking.status === "waitlisted" && (
          <Badge tone="ember">Waitlist #{booking.waitlist_position}</Badge>
        )}
        {booking.status === "attended" && <Badge tone="ok">Attended</Badge>}
        {booking.status === "no_show" && <Badge>Missed</Badge>}
      </div>
    </button>
  );
}

export function ScheduleList({
  upcoming,
  past,
}: {
  upcoming: MyBooking[];
  past: MyBooking[];
}) {
  const [selected, setSelected] = useState<MyBooking | null>(null);
  const [rescheduling, setRescheduling] = useState<MyBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cancelIsFree = selected
    ? new Date(selected.session.starts_at).getTime() - nowMs() >= 24 * 3600000
    : true;

  function doCancel() {
    if (!selected) return;
    startTransition(async () => {
      const r = await cancelBooking(selected.id);
      if (r.ok) setSelected(null);
      else setError(r.error ?? "Cancel failed.");
    });
  }

  function doCancelSeries() {
    if (!selected?.seriesId && !selected?.privateSeriesId) return;
    startTransition(async () => {
      const r = selected.privateSeriesId
        ? await cancelPrivateSeries(selected.privateSeriesId)
        : await cancelSeries(selected.seriesId!);
      if (r.ok) setSelected(null);
      else setError(r.error ?? "Couldn't stop the recurring booking.");
    });
  }

  return (
    <>
      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-4 space-y-3">
          {upcoming.length === 0 && (
            <EmptyState
              image="/images/empty-ivory.jpg"
              copy="Nothing booked. The table's free."
              action={<ButtonLink href="/app/book">Join group</ButtonLink>}
            />
          )}
          {upcoming.map((b) => (
            <BookingCard key={b.id} booking={b} onOpen={setSelected} />
          ))}
        </TabsContent>
        <TabsContent value="past" className="mt-4 space-y-3">
          {past.length === 0 && (
            <p className="py-8 text-center text-sm text-fg-2">No sessions yet.</p>
          )}
          {past.map((b) => (
            <BookingCard key={b.id} booking={b} />
          ))}
        </TabsContent>
      </Tabs>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.session.classTitle}
      >
        {selected && (
          <div className="space-y-5">
            <div>
              <p className="tnum font-display text-3xl">
                {fmt(selected.session.starts_at)}
              </p>
              <p className="mt-1 text-fg-2">
                {selected.session.venueName ?? "At your address"}
                {selected.session.coachName ? ` · Coach ${selected.session.coachName}` : ""}
                {selected.playerName ? ` · ${selected.playerName}` : ""}
              </p>
              {selected.session.address && (
                <AddressDisplay
                  address={selected.session.address}
                  audience="public"
                  className="mt-2"
                />
              )}
            </div>

            <a
              href={`/api/ics/${selected.id}`}
              className="inline-flex text-sm text-ember underline-offset-4 hover:underline"
            >
              Add to calendar
            </a>

            {selected.status === "confirmed" && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setRescheduling(selected);
                  setSelected(null);
                }}
              >
                {cancelIsFree ? "Reschedule (free)" : "Reschedule (uses your session)"}
              </Button>
            )}
            <ConfirmAction
              label={
                selected.seriesId || selected.privateSeriesId
                  ? cancelIsFree
                    ? "Cancel just this week (free)"
                    : "Cancel just this week (uses your session)"
                  : cancelIsFree
                    ? "Cancel this class (free)"
                    : "Cancel this class (uses your session)"
              }
              confirmLabel="Yes, cancel"
              prompt={
                (cancelIsFree
                  ? "You'll free the spot for someone else."
                  : "This is inside 24 hours of the start, so it counts as a used session.") +
                (selected.seriesId || selected.privateSeriesId
                  ? " Only this week is affected — future weeks stay booked."
                  : "")
              }
              pending={pending}
              onConfirm={doCancel}
            />
            {(selected.seriesId || selected.privateSeriesId) && (
              <ConfirmAction
                variant="ghost"
                label={
                  selected.privateSeriesId
                    ? "End weekly sessions (all future weeks)"
                    : "Stop recurring booking (all future weeks)"
                }
                confirmLabel="Yes, end it"
                prompt="This stops every future week, not just this one. You can book again anytime."
                pending={pending}
                onConfirm={doCancelSeries}
              />
            )}
            {error && <p className="text-sm text-err">{error}</p>}
          </div>
        )}
      </Sheet>

      {rescheduling && (
        <RescheduleSheet
          booking={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => setRescheduling(null)}
        />
      )}
    </>
  );
}
