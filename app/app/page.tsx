import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSubscriptionSummary, formatRenewalDate } from "@/lib/billing";
import { getMyBookings } from "@/lib/booking";
import { formatSessionDate } from "@/lib/data";
import { ClientShell } from "@/components/app/ClientShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { WhatsAppAssistantCard } from "@/components/app/WhatsAppAssistantCard";
import { AddressDisplay } from "@/components/app/AddressDisplay";
import { getMasteryMap, masteryLabel } from "@/lib/mastery";

export const metadata: Metadata = { title: "Home" };

export default async function AppHomePage() {
  const { supabase, user, profile } = await requireUser("/app");
  const [summary, bookings, playersRes] = await Promise.all([
    getSubscriptionSummary(supabase, user.id),
    getMyBookings(supabase, user.id),
    supabase
      .from("players")
      .select("id,full_name")
      .eq("client_id", user.id)
      .order("created_at"),
  ]);
  const players = playersRes.data ?? [];
  const masteryMap = await getMasteryMap(
    supabase,
    players.map((p) => p.id)
  );

  const upcoming = bookings.filter(
    (b) =>
      ["confirmed", "waitlisted"].includes(b.status) &&
      new Date(b.session.starts_at) > new Date()
  );
  const next = upcoming[0];
  const attended = bookings.filter((b) => b.status === "attended").length;

  const bookButtons = (
    <div className="grid grid-cols-2 gap-3">
      <ButtonLink href="/app/book" size="lg" className="w-full">
        Book group class
      </ButtonLink>
      <ButtonLink href="/app/book/private" size="lg" className="w-full">
        Book private class
      </ButtonLink>
    </div>
  );

  return (
    <ClientShell title={`Hi, ${profile.full_name.split(" ")[0]}`}>
      <div className="mx-auto max-w-2xl space-y-6">
        {next ? (
          <div data-mood="stage" className="rounded-[12px] border border-line bg-surface p-6 text-fg">
            <p className="label mb-2">Next session</p>
            <p className="font-display tnum text-4xl">
              {formatSessionDate(next.session.starts_at)}
            </p>
            <p className="mt-2 text-fg-2">
              {next.session.classTitle}
              {next.session.venueName ? ` — ${next.session.venueName}` : " — at your address"}
              {next.session.coachName ? ` · Coach ${next.session.coachName}` : ""}
            </p>
            {next.session.address && (
              <AddressDisplay
                address={next.session.address}
                audience="public"
                className="mt-2"
              />
            )}
            {(next.status === "waitlisted" || next.session.isPrivate) && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {next.status === "waitlisted" && <Badge tone="ember">Waitlist</Badge>}
                {next.session.isPrivate && <Badge>Private</Badge>}
              </div>
            )}
            <div className="mt-4">
              <ButtonLink href="/app/schedule" variant="ghost">
                Manage booking
              </ButtonLink>
            </div>
          </div>
        ) : summary.active ? (
          <div className="space-y-4">
            <EmptyState
              image="/images/empty-ivory.jpg"
              copy="Nothing booked. The table's free — book a class."
            />
            {bookButtons}
          </div>
        ) : (
          <EmptyState
            image="/images/empty-ivory.jpg"
            copy="Nothing booked. The table's free."
          />
        )}

        {players.length > 0 && (
          <div>
            <p className="label mb-3">Your players</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {players.map((p) => {
                const playerNext = upcoming.find((b) => b.playerId === p.id);
                const mastery = masteryMap.get(p.id) ?? 0;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/app/players/${p.id}`}
                      className="block rounded-[12px] border border-line bg-surface-2 p-4 transition-colors hover:border-ember"
                    >
                      <p className="font-medium">{p.full_name}</p>
                      <p className="mt-1 text-sm text-fg-2">
                        {playerNext
                          ? `Next: ${formatSessionDate(playerNext.session.starts_at)}`
                          : "Nothing booked"}
                      </p>
                      <p className="tnum mt-1 text-sm text-fg-2">
                        Mastery {mastery}% · {masteryLabel(mastery)}
                      </p>
                      <p className="mt-1 text-xs text-ember">Progress &amp; notes →</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Already shown under the empty state in the no-booking + active-plan
            branch — don't repeat it there. */}
        {(next || !summary.active) && bookButtons}

        <WhatsAppAssistantCard />

        {summary.active ? (
          <p className="text-sm text-fg-2">
            {summary.planName} — renews {formatRenewalDate(summary.periodEnd)}
            {summary.minutesBalance > 0
              ? ` · ${summary.minutesBalance} private min left`
              : ""}
          </p>
        ) : summary.hasAccountTrial || summary.openTrialPlayerIds.length > 0 ? (
          <div className="rounded-[12px] border border-ember bg-surface-2 p-4">
            <p className="font-display text-xl">
              Your first group class is free — on us. 🏓
            </p>
            <p className="mt-1 text-sm text-fg-2">
              Book the trial above — no payment details needed.
            </p>
          </div>
        ) : (
          <p className="text-sm text-fg-2">
            No active membership —{" "}
            <Link
              href="/app/membership"
              className="text-ember underline-offset-4 hover:underline"
            >
              see plans
            </Link>
            , or book a one-off class.
          </p>
        )}

        {attended > 0 && (
          <p className="tnum text-sm text-fg-2">
            {attended} session{attended === 1 ? "" : "s"} played. Keep the streak alive.
          </p>
        )}
      </div>
    </ClientShell>
  );
}
