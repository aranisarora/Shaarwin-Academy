import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OnboardingFlow } from "@/components/app/OnboardingFlow";

export const metadata: Metadata = { title: "Who's playing?" };

/**
 * One-time household setup. requireUser routes every not-yet-onboarded client
 * here (including accounts created before this flow existed); completing it
 * stamps profiles.onboarded_at and releases the redirect.
 */
export default async function OnboardingPage() {
  const { supabase, user, profile } = await requireUser("/app/onboarding");
  if (profile.role !== "client" || profile.onboarded_at) redirect("/app");

  const { data: players } = await supabase
    .from("players")
    .select("id,full_name,date_of_birth,skill_level")
    .eq("client_id", user.id)
    .order("created_at");

  const { data: waLink } = await supabase
    .from("wa_links")
    .select("phone")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">

      <OnboardingFlow 
        profileName={profile.full_name} 
        existing={players ?? []} 
        initialStep={profile.onboarding_step ?? 1}
        hasWaLink={!!waLink}
        notificationPrefs={profile.notification_prefs}
      />
    </main>
  );
}
