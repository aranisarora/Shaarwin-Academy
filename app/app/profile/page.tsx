import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ClientShell } from "@/components/app/ClientShell";
import { ProfileEditor } from "@/components/app/ProfileEditor";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { supabase, user, profile } = await requireUser("/app/profile");
  const { data: players } = await supabase
    .from("players")
    .select("id,full_name,date_of_birth,skill_level")
    .eq("client_id", user.id)
    .order("created_at");

  return (
    <ClientShell title="Profile">
      <div className="mx-auto max-w-xl space-y-8">
        <ProfileEditor
          profile={{
            fullName: profile.full_name,
            phone: profile.phone ?? "",
            defaultAddress: profile.default_address ?? "",
            prefs: profile.notification_prefs ?? {},
          }}
          players={players ?? []}
        />
      </div>
    </ClientShell>
  );
}
