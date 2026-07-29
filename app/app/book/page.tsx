import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getSubscriptionSummary } from "@/lib/billing";
import { getBrowseSessions } from "@/lib/booking";
import { getVenues } from "@/lib/data";
import { ClientShell } from "@/components/app/ClientShell";
import { BookBrowser } from "@/components/app/BookBrowser";
import { BookModeSwitch } from "@/components/app/BookModeSwitch";
import { OnboardingBanner } from "@/components/app/onboarding/OnboardingBanner";
import { RealtimeRefresh } from "@/components/app/RealtimeRefresh";
import { PageSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Book" };

type DB = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** The browsable session list — streamed, so the shell and mode switch paint first. */
async function Browser({
  supabase,
  userId,
  onboarding,
}: {
  supabase: DB;
  userId: string;
  onboarding: boolean;
}) {
  const [sessions, venues, summary, players] = await Promise.all([
    getBrowseSessions(supabase, userId),
    getVenues(),
    getSubscriptionSummary(supabase, userId),
    supabase
      .from("players")
      .select("id,full_name")
      .eq("client_id", userId)
      .then((r) => r.data ?? []),
  ]);

  return (
    <BookBrowser
      sessions={sessions}
      venues={venues}
      players={players}
      onboarding={onboarding}
      entitlement={{
        hasGroupPlan: Boolean(summary.groupPlan?.active),
        // The account-level trial can go to any household player.
        trialPlayerIds: summary.hasAccountTrial
          ? players.map((p) => p.id)
          : summary.openTrialPlayerIds,
        // Used to show "trial already used" vs generic "no entitlement".
        usedTrialPlayerIds: summary.accountTrialUsed
          ? players.map((p) => p.id)
          : summary.usedTrialPlayerIds,
        dropinCredits: summary.dropinCredits,
      }}
    />
  );
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { onboarding } = await searchParams;
  const { supabase, user } = await requireUser("/app/book");
  return (
    <ClientShell title="Book group class">
      <RealtimeRefresh tables={["bookings", "class_sessions"]} />
      {onboarding === "1" ? (
        <OnboardingBanner />
      ) : (
        <BookModeSwitch active="group" />
      )}
      <Suspense fallback={<PageSkeleton />}>
        <Browser
          supabase={supabase}
          userId={user.id}
          onboarding={onboarding === "1"}
        />
      </Suspense>
    </ClientShell>
  );
}
