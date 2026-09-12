import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { WHATSAPP_NUMBER } from "@/lib/contact";
import { PendingFlow } from "./PendingFlow";

export const metadata: Metadata = { title: "Requesting access" };

/**
 * The closed-membership holding screen. requireUser routes any not-yet-approved
 * client here; an approved client is bounced straight back into the app (the
 * same pattern onboarding uses). Coaches/founders never reach this route.
 */
export default async function PendingPage() {
  const { profile } = await requireUser("/app/pending");

  if (profile.role !== "client" || profile.approval_status === "approved") {
    redirect("/app");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-16">
      <PendingFlow
        initialStatus={profile.approval_status}
        initialName={profile.full_name ?? ""}
        phone={profile.phone}
        whatsappNumber={WHATSAPP_NUMBER}
      />
    </main>
  );
}
