import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getSubscriptionSummary } from "@/lib/billing";
import { getBrowseSessions } from "@/lib/booking";
import { getVenues } from "@/lib/data";
import { ClientShell } from "@/components/app/ClientShell";
import { BookBrowser } from "@/components/app/BookBrowser";
import { RealtimeRefresh } from "@/components/app/RealtimeRefresh";

export const metadata: Metadata = { title: "Book" };

export default async function BookPage() {
  const { supabase, user } = await requireUser("/app/book");
  const [sessions, venues, summary, players] = await Promise.all([
    getBrowseSessions(supabase),
    getVenues(),
    getSubscriptionSummary(supabase, user.id),
    supabase
      .from("players")
      .select("id,full_name")
      .eq("client_id", user.id)
      .then((r) => r.data ?? []),
  ]);

  return (
    <ClientShell title="Join group">
      <RealtimeRefresh tables={["bookings", "class_sessions"]} />
      <BookBrowser
        sessions={sessions}
        venues={venues}
        players={players}
        entitlement={{
          hasGroupPlan: Boolean(summary.groupPlan?.active),
          // The account-level trial can go to any household player.
          trialPlayerIds: summary.hasAccountTrial
            ? players.map((p) => p.id)
            : summary.openTrialPlayerIds,
          dropinCredits: summary.dropinCredits,
        }}
      />
    </ClientShell>
  );
}
