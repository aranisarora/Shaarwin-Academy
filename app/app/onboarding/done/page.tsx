import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWhatsAppLinkedPhone } from "@/lib/whatsapp/link-action";
import { InstallStep } from "@/components/app/onboarding/InstallStep";
import { WhatsAppConnectCard } from "@/components/app/WhatsAppConnectCard";

export const metadata: Metadata = { title: "You're all set" };

/**
 * Final onboarding screen, reached after the first booking (group and private
 * both land here): connect the WhatsApp assistant, then get the app on the
 * home screen. WhatsApp lives here — not mid-flow — because tapping Connect
 * leaves the app, and users who left before booking rarely came back. Lives
 * outside the onboarded_at gate (booking already stamped it); install is last
 * because iOS install is a manual Share-sheet flow with no completion event,
 * so it can't hard-block mid-flow.
 */
export default async function OnboardingDonePage() {
  const { profile } = await requireUser("/app/onboarding/done");
  if (profile.role !== "client") redirect("/app");

  const linkedPhone = await getWhatsAppLinkedPhone();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <InstallStep whatsAppSlot={<WhatsAppConnectCard linkedPhone={linkedPhone} />} />
    </main>
  );
}
