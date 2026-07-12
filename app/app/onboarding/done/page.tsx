import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { InstallStep } from "@/components/app/onboarding/InstallStep";

export const metadata: Metadata = { title: "You're all set" };

/**
 * Final onboarding screen, reached after the first booking: get the app on
 * the home screen. Lives outside the onboarded_at gate (booking already
 * stamped it) — install is last because iOS install is a manual Share-sheet
 * flow with no completion event, so it can't hard-block mid-flow.
 */
export default async function OnboardingDonePage() {
  const { profile } = await requireUser("/app/onboarding/done");
  if (profile.role !== "client") redirect("/app");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <InstallStep />
    </main>
  );
}
