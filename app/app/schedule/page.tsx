import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getMyBookings } from "@/lib/booking";
import { ClientShell } from "@/components/app/ClientShell";
import { ScheduleList } from "@/components/app/ScheduleList";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const { supabase, user } = await requireUser("/app/schedule");
  const bookings = await getMyBookings(supabase, user.id);

  const now = Date.now();
  const upcoming = bookings.filter(
    (b) =>
      ["confirmed", "waitlisted"].includes(b.status) &&
      new Date(b.session.starts_at).getTime() > now
  );
  const past = bookings.filter(
    (b) => new Date(b.session.starts_at).getTime() <= now
  );

  return (
    <ClientShell title="Schedule">
      <div className="mx-auto max-w-2xl">
        <ScheduleList upcoming={upcoming} past={past} />
      </div>
    </ClientShell>
  );
}
