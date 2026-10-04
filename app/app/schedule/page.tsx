import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getMyBookings, splitBookings } from "@/lib/booking";
import { ClientShell } from "@/components/app/ClientShell";
import { ScheduleList } from "@/components/app/ScheduleList";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { nowMs } from "@/lib/academy-time";

export const metadata: Metadata = { title: "Schedule" };

const PAST_PAGE = 20;

type SearchParams = Promise<{ past?: string }>;

function pastLimit(raw: string | undefined): number {
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : PAST_PAGE;
  return Math.max(PAST_PAGE, n);
}

/**
 * The booking list, streamed under the shell rather than blocking it. It calls
 * `requireUser` itself so the shell above does not have to await auth — see the
 * Phase A note in docs/plans/instant-navigation.md.
 */
async function Bookings({ searchParams }: { searchParams: SearchParams }) {
  const { past: pastParam } = await searchParams;
  const limit = pastLimit(pastParam);
  const { supabase, user } = await requireUser("/app/schedule");
  const bookings = await getMyBookings(supabase, user.id, limit);
  const { upcoming, past } = splitBookings(bookings, nowMs());

  return (
    <ScheduleList
      upcoming={upcoming}
      past={past}
      tab={pastParam ? "past" : "upcoming"}
      olderHref={past.length >= limit ? `/app/schedule?past=${limit + PAST_PAGE}` : null}
    />
  );
}

export default function SchedulePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <ClientShell title="Schedule">
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <Bookings searchParams={searchParams} />
        </Suspense>
      </div>
    </ClientShell>
  );
}
