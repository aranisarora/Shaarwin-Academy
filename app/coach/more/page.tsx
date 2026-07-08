import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { CoachProfileEditor } from "@/components/app/CoachProfileEditor";
import { AvailabilityEditor } from "@/components/app/AvailabilityEditor";
import { SignOutButton } from "@/components/app/SignOutButton";

export const metadata: Metadata = { title: "More" };

export default async function CoachMorePage() {
  const { supabase, user, profile } = await requireUser("/coach/more");
  const [{ data: coach }, { data: windows }, { data: timeOff }] =
    await Promise.all([
      supabase
        .from("coaches")
        .select("bio,base_lat,base_lng,travel_radius_km")
        .eq("id", user.id)
        .maybeSingle(),
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
    <CoachShell title="More" actions={<SignOutButton />}>
      <div className="mx-auto max-w-2xl space-y-8">
        <CoachProfileEditor
          fullName={profile.full_name}
          bio={coach?.bio ?? ""}
          baseLat={coach?.base_lat ?? 51.5074}
          baseLng={coach?.base_lng ?? -0.1278}
          radiusKm={Number(coach?.travel_radius_km ?? 10)}
        />
        <AvailabilityEditor windows={windows ?? []} timeOff={timeOff ?? []} />
      </div>
    </CoachShell>
  );
}
