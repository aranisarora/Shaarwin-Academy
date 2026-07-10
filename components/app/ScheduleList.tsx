"use client";

import { useState, useTransition } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { cancelBooking } from "@/app/app/book/actions";
import { cancelSeries } from "@/app/app/schedule/actions";
import { RescheduleSheet } from "@/components/app/RescheduleSheet";
import { AddressDisplay } from "@/components/app/AddressDisplay";
import type { MyBooking } from "@/lib/booking";
import { nowMs } from "@/lib/academy-time";

function fmt(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

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
        {booking.seriesId && <Badge tone="ember">Weekly</Badge>}
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
    if (!selected?.seriesId) return;
    startTransition(async () => {
      const r = await cancelSeries(selected.seriesId!);
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
            <Button
              variant="destructive"
              onClick={doCancel}
              disabled={pending}
              className="w-full"
            >
              {pending ? (
                <Spinner />
              ) : selected.seriesId ? (
                cancelIsFree ? "Cancel just this week (free)" : "Cancel just this week (uses your session)"
              ) : cancelIsFree ? (
                "Cancel (free)"
              ) : (
                "Cancel (uses your session)"
              )}
            </Button>
            {selected.seriesId && (
              <Button
                variant="ghost"
                onClick={doCancelSeries}
                disabled={pending}
                className="w-full"
              >
                Stop recurring booking (all future weeks)
              </Button>
            )}
            {!cancelIsFree && (
              <p className="text-xs text-fg-2">
                Inside 24 hours of the start, cancelled sessions count as used.
              </p>
            )}
            {error && <p className="text-sm text-err">{error}</p>}
          </div>
        )}
      </Sheet>

      <RescheduleSheet
        booking={rescheduling}
        onClose={() => setRescheduling(null)}
        onDone={() => setRescheduling(null)}
      />
    </>
  );
}
