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

type SearchParams = Promise<{ onboarding?: string }>;

/**
 * The switch between group and private booking — or the onboarding banner, when
 * the flow routed here. Needs `searchParams` and nothing else, so it sits in its
 * own boundary: it resolves without a network call while the browser below is
 * still querying, rather than being held back by it.
 */
async function Header({ searchParams }: { searchParams: SearchParams }) {
  const { onboarding } = await searchParams;
  return onboarding === "1" ? <OnboardingBanner /> : <BookModeSwitch active="group" />;
}

/** The browsable session list — streamed, so the shell and mode switch paint first. */
async function Browser({ searchParams }: { searchParams: SearchParams }) {
  const { onboarding } = await searchParams;
  const { supabase, user } = await requireUser("/app/book");
  const userId = user.id;

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
      onboarding={onboarding === "1"}
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

export default function BookPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <ClientShell title="Book group class">
      <RealtimeRefresh tables={["bookings", "class_sessions"]} />
      {/* Passed down unawaited: awaiting searchParams here would block the
          shell for exactly the reason requireUser used to. */}
      <Suspense fallback={<div className="h-10" />}>
        <Header searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<PageSkeleton />}>
        <Browser searchParams={searchParams} />
      </Suspense>
    </ClientShell>
  );
}
