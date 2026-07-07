import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { AvailabilityEditor } from "@/components/app/AvailabilityEditor";
import { SignOutButton } from "@/components/app/SignOutButton";

export const metadata: Metadata = { title: "Availability" };

export default async function CoachAvailabilityPage() {
  const { supabase, user } = await requireUser("/coach/availability");
  const [{ data: windows }, { data: timeOff }] = await Promise.all([
    supabase
      .from("coach_availability")
      .select("id,weekday,start_time,end_time")
      .eq("coach_id", user.id)
      .order("weekday")
      .order("start_time"),
    supabase
      .from("coach_time_off")
      .select("id,starts_at,ends_at,reason,status")
      .eq("coach_id", user.id)
      .order("starts_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <CoachShell title="Availability" actions={<SignOutButton />}>
      <div className="mx-auto max-w-2xl">
        <AvailabilityEditor
          windows={windows ?? []}
          timeOff={timeOff ?? []}
        />
      </div>
    </CoachShell>
  );
}
