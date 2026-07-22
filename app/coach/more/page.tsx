import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { CoachShell } from "@/components/app/CoachShell";
import { CoachProfileEditor } from "@/components/app/CoachProfileEditor";
import { AvailabilityEditor } from "@/components/app/AvailabilityEditor";
import { WhatsAppAssistantCard } from "@/components/app/WhatsAppAssistantCard";
import { InstallAppCard } from "@/components/app/InstallAppCard";
import { SignOutButton } from "@/components/app/SignOutButton";

export const metadata: Metadata = { title: "More" };

export default async function CoachMorePage() {
  const { supabase, user, profile } = await requireUser("/coach/more");
  const coachId = await effectiveCoachId(user.id);
  const [{ data: coach }, { data: windows }, { data: timeOff }] =
    await Promise.all([
      supabase
        .from("coaches")
        .select("bio,base_lat,base_lng,base_address")
        .eq("id", coachId)
        .maybeSingle(),
      supabase
        .from("coach_availability")
        .select("id,weekday,start_time,end_time")
        .eq("coach_id", coachId)
        .order("weekday")
        .order("start_time"),
      supabase
        .from("coach_time_off")
        .select("id,starts_at,ends_at,reason,status")
        .eq("coach_id", coachId)
        .order("starts_at", { ascending: false })
        .limit(10),
    ]);

  return (
    <CoachShell title="More" actions={<SignOutButton />}>
      <div className="mx-auto max-w-2xl space-y-8">
        <CoachProfileEditor
          fullName={profile.full_name}
          bio={coach?.bio ?? ""}
          baseLat={coach?.base_lat ?? 12.9716}
          baseLng={coach?.base_lng ?? 77.5946}
          baseAddress={coach?.base_address ?? ""}
        />
        <AvailabilityEditor windows={windows ?? []} timeOff={timeOff ?? []} />
        <WhatsAppAssistantCard />
        <InstallAppCard />
      </div>
    </CoachShell>
  );
}
