import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getSubscriptionSummary } from "@/lib/billing";
import type { CoachRosterRow } from "@/lib/data";
import { ClientShell } from "@/components/app/ClientShell";
import { BookModeSwitch } from "@/components/app/BookModeSwitch";
import { OnboardingBanner } from "@/components/app/onboarding/OnboardingBanner";
import { PrivateWizard } from "@/components/app/PrivateWizard";
import { PageSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Private session" };

type SearchParams = Promise<{ onboarding?: string }>;

/** The mode switch — needs searchParams only, so it resolves without a query. */
async function Header({ searchParams }: { searchParams: SearchParams }) {
  const { onboarding } = await searchParams;
  return onboarding === "1" ? <OnboardingBanner /> : <BookModeSwitch active="private" />;
}

async function Wizard({ searchParams }: { searchParams: SearchParams }) {
  const { onboarding } = await searchParams;
  const { supabase, user, profile } = await requireUser("/app/book/private");
  const [summary, playersRes, coachesRes] = await Promise.all([
    getSubscriptionSummary(supabase, user.id),
    supabase.from("players").select("id,full_name").eq("client_id", user.id),
    // Clients can't read other people's `profiles` rows, so the coach name has
    // to come from the definer-rights roster function, not a join.
    supabase.rpc("public_coach_roster"),
  ]);

  const coaches = ((coachesRes.data ?? []) as CoachRosterRow[]).map((c) => ({
    id: c.id,
    name: c.full_name,
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
    <PrivateWizard
      players={playersRes.data ?? []}
      coaches={coaches}
      minutesBalance={summary.minutesBalance}
      defaultAddress={profile.default_address}
      defaultAddressDetails={profile.address_details}
      privatePlan={privatePlan}
      onboarding={onboarding === "1"}
    />
  );
}

export default function PrivateBookingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <ClientShell title="Book private class">
      <Suspense fallback={<div className="h-10" />}>
        <Header searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<PageSkeleton />}>
        <Wizard searchParams={searchParams} />
      </Suspense>
    </ClientShell>
  );
}
