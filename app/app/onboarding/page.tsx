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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display mb-2 text-4xl">Who&apos;s playing?</h1>
      <p className="mb-8 text-fg-2">
        Set up the players on your account — you can book classes for each of
        them. Change this any time from your profile.
      </p>
      <OnboardingFlow profileName={profile.full_name} existing={players ?? []} />
    </main>
  );
}
