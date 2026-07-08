import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSubscriptionSummary, formatRenewalDate } from "@/lib/billing";
import { getPlans, formatPrice } from "@/lib/data";
import { ClientShell } from "@/components/app/ClientShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PlanPicker } from "@/components/app/PlanPicker";
import { ManageBillingButton } from "@/components/app/ManageBillingButton";
import { SignOutButton } from "@/components/app/SignOutButton";

export const metadata: Metadata = { title: "Membership" };

export default async function MembershipPage() {
  const { supabase, user, profile } = await requireUser("/app/membership");
  const [summary, plans] = await Promise.all([
    getSubscriptionSummary(supabase, user.id),
    getPlans(),
  ]);

  return (
    <ClientShell title="Membership">
      <div className="mx-auto max-w-2xl">
        <div className="relative mb-6 h-40 overflow-hidden rounded-[12px] border border-line">
          <Image
            src="/images/membership-still.jpg"
            alt=""
            fill
            sizes="(min-width: 768px) 672px, 100vw"
            className="object-cover"
            aria-hidden
          />
        </div>

        {summary.status === "past_due" && (
          <div className="mb-6 rounded-[12px] border border-err bg-surface-2 p-4">
            <p className="font-medium text-err">Payment didn&apos;t go through</p>
            <p className="mt-1 text-sm text-fg-2">
              Razorpay will retry your payment automatically and email you a
              secure link. Need a hand? Message us on WhatsApp.
            </p>
          </div>
        )}

        {summary.planName ? (
          <Card className="mb-6">
            <Card.Content>
              <div className="flex items-start justify-between">
                <div>
                  <p className="label mb-1">Your plan</p>
                  <p className="font-display text-3xl">{summary.planName}</p>
                </div>
                <Badge tone={summary.active ? "ok" : "err"}>
                  {summary.status}
                </Badge>
              </div>
              <p className="mt-3 text-fg-2">
                {summary.cancelAtPeriodEnd
                  ? `Ends ${formatRenewalDate(summary.periodEnd)} — access runs to the end of your quarter.`
                  : `Renews ${formatRenewalDate(summary.periodEnd)}.`}
              </p>
              {summary.minutesBalance > 0 && (
                <p className="tnum mt-1 text-fg-2">
                  {summary.minutesBalance} private minutes left this quarter.
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-3">
                <ManageBillingButton label="Cancel membership" />
                <Link
                  href="/app/book"
                  className="inline-flex min-h-11 items-center rounded-[8px] border border-line px-5 font-semibold hover:border-ember hover:text-ember"
                >
                  Book a class
                </Link>
              </div>
            </Card.Content>
          </Card>
        ) : (
          <div className="mb-6">
            <p className="label mb-3">Choose a plan</p>
            <PlanPicker
              plans={plans.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description ?? "",
                price: formatPrice(p.price_pence),
              }))}
              clientName={profile.full_name}
              clientEmail={profile.email}
            />
          </div>
        )}

        <Card>
          <Card.Content>
            <p className="label mb-2">Account</p>
            <p className="font-medium">{profile.full_name}</p>
            <p className="text-sm text-fg-2">{profile.email}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/app/profile"
                className="inline-flex min-h-11 items-center rounded-[8px] border border-line px-5 text-sm font-semibold hover:border-ember hover:text-ember"
              >
                Edit profile
              </Link>
              <Link
                href="/app/notifications"
                className="inline-flex min-h-11 items-center rounded-[8px] border border-line px-5 text-sm font-semibold hover:border-ember hover:text-ember"
              >
                Notifications
              </Link>
              <SignOutButton />
            </div>
          </Card.Content>
        </Card>
      </div>
    </ClientShell>
  );
}
