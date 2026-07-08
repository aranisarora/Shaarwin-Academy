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
import { WhatsAppConnect } from "@/components/app/WhatsAppConnect";

export const metadata: Metadata = { title: "Home" };

export default async function AppHomePage() {
  const { supabase, user, profile } = await requireUser("/app");
  const [summary, bookings] = await Promise.all([
    getSubscriptionSummary(supabase, user.id),
    getMyBookings(supabase, user.id),
  ]);

  const upcoming = bookings.filter(
    (b) =>
      ["confirmed", "waitlisted"].includes(b.status) &&
      new Date(b.session.starts_at) > new Date()
  );
  const next = upcoming[0];
  const attended = bookings.filter((b) => b.status === "attended").length;

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
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {next.status === "waitlisted" && <Badge tone="ember">Waitlist</Badge>}
              {next.session.isPrivate && <Badge>Private</Badge>}
              <Link
                href="/app/schedule"
                className="text-sm text-ember underline-offset-4 hover:underline"
              >
                Manage booking
              </Link>
            </div>
          </div>
        ) : (
          <EmptyState
            image="/images/empty-ivory.jpg"
            copy="Nothing booked. The table's free."
            action={<ButtonLink href="/app/book">Join group</ButtonLink>}
          />
        )}

        <WhatsAppConnect />

        <p className="text-sm text-fg-2">
          {summary.active
            ? `${summary.planName} — renews ${formatRenewalDate(summary.periodEnd)}${
                summary.minutesBalance > 0 ? ` · ${summary.minutesBalance} private min left` : ""
              }`
            : "No active membership — choose a plan to start booking."}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <ButtonLink href="/app/book" className="w-full">
            Join group
          </ButtonLink>
          <ButtonLink href="/app/book/private" variant="ghost" className="w-full">
            Private
          </ButtonLink>
        </div>

        {attended > 0 && (
          <p className="tnum text-sm text-fg-2">
            {attended} session{attended === 1 ? "" : "s"} played. Keep the streak alive.
          </p>
        )}
      </div>
    </ClientShell>
  );
}
