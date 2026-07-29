import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getMyBookings } from "@/lib/booking";
import { ClientShell } from "@/components/app/ClientShell";
import { ScheduleList } from "@/components/app/ScheduleList";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { nowMs } from "@/lib/academy-time";

export const metadata: Metadata = { title: "Schedule" };

/**
 * The booking list, streamed under the shell rather than blocking it. It calls
 * `requireUser` itself so the shell above does not have to await auth — see the
 * Phase A note in docs/plans/instant-navigation.md.
 */
async function Bookings() {
  const { supabase, user } = await requireUser("/app/schedule");
  const bookings = await getMyBookings(supabase, user.id);

  const now = nowMs();
  const upcoming = bookings.filter(
    (b) =>
      ["confirmed", "waitlisted"].includes(b.status) &&
      new Date(b.session.starts_at).getTime() > now
  );
  const past = bookings.filter(
    (b) => new Date(b.session.starts_at).getTime() <= now
  );

  return <ScheduleList upcoming={upcoming} past={past} />;
}

export default function SchedulePage() {
  return (
    <ClientShell title="Schedule">
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <Bookings />
        </Suspense>
      </div>
    </ClientShell>
  );
}
