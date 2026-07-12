import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWhatsAppLinkedPhone } from "@/lib/whatsapp/link-action";
import { InstallStep } from "@/components/app/onboarding/InstallStep";
import { WhatsAppSayHi } from "@/components/app/WhatsAppSayHi";

export const metadata: Metadata = { title: "You're all set" };

/**
 * Final onboarding screen, reached after the first booking (group and private
 * both land here): say hi to the WhatsApp assistant, then get the app on the
 * home screen. The WhatsApp CTA is a plain wa.me deep link — the phone step
 * already captured the number, so the bot auto-links on the first message; no
 * code flow, and it's hidden once a link exists. Lives outside the
 * onboarded_at gate (booking already stamped it); install is last because iOS
 * install is a manual Share-sheet flow with no completion event, so it can't
 * hard-block mid-flow.
 */
export default async function OnboardingDonePage() {
  const { profile } = await requireUser("/app/onboarding/done");
  if (profile.role !== "client") redirect("/app");

  const linkedPhone = await getWhatsAppLinkedPhone();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <InstallStep whatsAppSlot={linkedPhone ? null : <WhatsAppSayHi />} />
    </main>
  );
}
