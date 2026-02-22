"use client";

import { useEffect, useState, useCallback } from "react";
import { ClassCard } from "@/components/dashboard/class-card";
import { MarkAbsentDialog } from "@/components/dashboard/mark-absent-dialog";
import { RescheduleDialog } from "@/components/dashboard/reschedule-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { getUserSchedule } from "@/actions/calendar";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import type { UserScheduleEvent } from "@/types/calendar";

export default function BookingsPage() {
  const [events, setEvents] = useState<UserScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [absentEvent, setAbsentEvent] = useState<UserScheduleEvent | null>(null);
  const [rescheduleEvent, setRescheduleEvent] = useState<UserScheduleEvent | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const schedule = await getUserSchedule();
      setEvents(schedule);
    } catch {
      // User may not have any events
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Bookings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upcoming classes from your Google Calendar
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchEvents}
            disabled={loading}
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild size="sm">
            <Link href="/book">Book New</Link>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No upcoming classes found.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/book">Book Your First Class</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <ClassCard
              key={`${event.id}-${event.startTime}`}
              event={event}
              onMarkAbsent={setAbsentEvent}
              onReschedule={setRescheduleEvent}
            />
          ))}
        </div>
      )}

      <MarkAbsentDialog
        event={absentEvent}
        open={!!absentEvent}
        onOpenChange={(open) => !open && setAbsentEvent(null)}
        onSuccess={fetchEvents}
      />

      <RescheduleDialog
        event={rescheduleEvent}
        open={!!rescheduleEvent}
        onOpenChange={(open) => !open && setRescheduleEvent(null)}
        onSuccess={fetchEvents}
      />
    </div>
  );
}
