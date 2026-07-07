import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { CoachProfileEditor } from "@/components/app/CoachProfileEditor";
import { SignOutButton } from "@/components/app/SignOutButton";
import { WhatsAppConnect } from "@/components/app/WhatsAppConnect";

export const metadata: Metadata = { title: "Profile" };

export default async function CoachProfilePage() {
  const { supabase, user, profile } = await requireUser("/coach/profile");
  const { data: coach } = await supabase
    .from("coaches")
    .select("bio,base_lat,base_lng,travel_radius_km")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <CoachShell title="Profile" actions={<SignOutButton />}>
      <div className="mx-auto max-w-xl space-y-8">
        <WhatsAppConnect />
        <CoachProfileEditor
          fullName={profile.full_name}
          bio={coach?.bio ?? ""}
          baseLat={coach?.base_lat ?? 51.5074}
          baseLng={coach?.base_lng ?? -0.1278}
          radiusKm={Number(coach?.travel_radius_km ?? 10)}
        />
      </div>
    </CoachShell>
  );
}
