import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getMyBookings } from "@/lib/booking";
import { ClientShell } from "@/components/app/ClientShell";
import { ScheduleList } from "@/components/app/ScheduleList";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { nowMs } from "@/lib/academy-time";

export const metadata: Metadata = { title: "Schedule" };

type DB = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** The booking list, streamed under the shell rather than blocking it. */
async function Bookings({ supabase, userId }: { supabase: DB; userId: string }) {
  const bookings = await getMyBookings(supabase, userId);

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

export default async function SchedulePage() {
  const { supabase, user } = await requireUser("/app/schedule");
  return (
    <ClientShell title="Schedule">
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <Bookings supabase={supabase} userId={user.id} />
        </Suspense>
      </div>
    </ClientShell>
  );
}
