import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getSubscriptionSummary } from "@/lib/billing";
import { ClientShell } from "@/components/app/ClientShell";
import { BookModeSwitch } from "@/components/app/BookModeSwitch";
import { OnboardingBanner } from "@/components/app/onboarding/OnboardingBanner";
import { PrivateWizard } from "@/components/app/PrivateWizard";

export const metadata: Metadata = { title: "Private session" };

export default async function PrivateBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { onboarding } = await searchParams;
  const { supabase, user, profile } = await requireUser("/app/book/private");
  const [summary, playersRes, coachesRes] = await Promise.all([
    getSubscriptionSummary(supabase, user.id),
    supabase.from("players").select("id,full_name").eq("client_id", user.id),
    supabase
      .from("coaches")
      .select("id,base_lat,base_lng,profiles!inner(full_name)")
      .eq("active", true),
  ]);

  const coaches = (coachesRes.data ?? []).map((c) => ({
    id: c.id,
    name: (c.profiles as unknown as { full_name: string }).full_name,
    lat: c.base_lat,
    lng: c.base_lng,
  }));

  const privatePlan = summary.privatePlan?.active
    ? {
        sessionsPerWeek: summary.privatePlan.privateSessionsPerWeek,
        sessionMinutes: summary.privatePlan.privateSessionMinutes,
      }
    : null;

  return (
    <ClientShell title="Book private class">
      {onboarding === "1" ? <OnboardingBanner /> : <BookModeSwitch active="private" />}
      <PrivateWizard
        players={playersRes.data ?? []}
        coaches={coaches}
        minutesBalance={summary.minutesBalance}
        defaultAddress={profile.default_address}
        privatePlan={privatePlan}
        onboarding={onboarding === "1"}
      />
    </ClientShell>
  );
}
