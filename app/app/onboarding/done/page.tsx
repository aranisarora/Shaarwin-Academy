import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { InstallStep } from "@/components/app/onboarding/InstallStep";
import { WhatsAppSayHi } from "@/components/app/WhatsAppSayHi";

export const metadata: Metadata = { title: "You're all set" };

/**
 * Final onboarding screen, reached after the first booking (group and private
 * both land here): say hi to the WhatsApp assistant, then get the app on the
 * home screen. The account is already linked to its number (the phone step
 * writes wa_links), so the CTA's job is opening the WhatsApp chat — a first
 * message starts the 24h session window that lets the assistant reply
 * free-form instead of via template. Lives outside the onboarded_at gate
 * (booking already stamped it); install is last because iOS install is a
 * manual Share-sheet flow with no completion event, so it can't hard-block
 * mid-flow.
 */
export default async function OnboardingDonePage() {
  const { profile } = await requireUser("/app/onboarding/done");
  if (profile.role !== "client") redirect("/app");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <InstallStep whatsAppSlot={<WhatsAppSayHi />} />
    </main>
  );
}
