import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OnboardingFlow } from "@/components/app/OnboardingFlow";

export const metadata: Metadata = { title: "Set up your account" };

/**
 * Guided first-run setup: players → phone number → choose private/group and
 * book. WhatsApp linking waits until after the first booking
 * (/app/onboarding/done) so nothing pulls the user out of the app mid-flow;
 * notification prefs default to all-on and live in profile settings.
 * requireUser routes every not-yet-onboarded client here (including accounts
 * created before this flow existed); profiles.onboarding_step decides where a
 * returning user resumes.
 */
export default async function OnboardingPage() {
  const { supabase, user, profile } = await requireUser("/app/onboarding");
  if (profile.role !== "client" || profile.onboarded_at) redirect("/app");

  const [{ data: players }, { data: stepRow }] = await Promise.all([
    supabase
      .from("players")
      .select("id,full_name,date_of_birth")
      .eq("client_id", user.id)
      .order("created_at"),
    supabase
      .from("profiles")
      .select("onboarding_step,phone")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <OnboardingFlow
        profileName={profile.full_name}
        existing={players ?? []}
        initialStep={stepRow?.onboarding_step ?? 0}
        linkedPhone={stepRow?.phone ?? null}
      />
    </main>
  );
}
