import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  getSubscriptionSummary,
  formatRenewalDate,
  type PlanSummary,
} from "@/lib/billing";
import { getPlans, getProducts, formatPrice } from "@/lib/data";
import { whatsappLink } from "@/lib/contact";
import { ClientShell } from "@/components/app/ClientShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PlanPicker } from "@/components/app/PlanPicker";
import { OneOffPicker } from "@/components/app/OneOffPicker";
import { ManageBillingButton } from "@/components/app/ManageBillingButton";

export const metadata: Metadata = { title: "Membership" };

function CurrentPlanCard({
  plan,
  minutesBalance,
}: {
  plan: PlanSummary;
  minutesBalance?: number;
}) {
  return (
    <Card className="mb-6">
      <Card.Content>
        <div className="flex items-start justify-between">
          <div>
            <p className="label mb-1">Your plan</p>
            <p className="font-display text-3xl">{plan.planName}</p>
          </div>
          <Badge tone={plan.active ? "ok" : "err"}>{plan.status}</Badge>
        </div>
        <p className="mt-3 text-fg-2">
          {plan.cancelAtPeriodEnd
            ? `Ends ${formatRenewalDate(plan.periodEnd)} — access runs to the end of your month.`
            : `Renews ${formatRenewalDate(plan.periodEnd)}.`}
        </p>
        {typeof minutesBalance === "number" && minutesBalance > 0 && (
          <p className="tnum mt-1 text-fg-2">
            {minutesBalance} private minutes available.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <ManageBillingButton label="Cancel membership" planId={plan.planId} />
        </div>
      </Card.Content>
    </Card>
  );
}

export default async function MembershipPage() {
  const { supabase, user, profile } = await requireUser("/app/membership");
  const [summary, plans, products, playersRes, introOrdersRes] =
    await Promise.all([
      getSubscriptionSummary(supabase, user.id),
      getPlans(),
      getProducts(),
      supabase.from("players").select("id,full_name").eq("client_id", user.id),
      supabase
        .from("orders")
        .select("player_id, products!inner(kind)")
        .eq("client_id", user.id)
        .eq("status", "paid")
        .eq("products.kind", "private_intro"),
    ]);

  const players = playersRes.data ?? [];
  const introUsed = new Set(
    (introOrdersRes.data ?? []).map((o) => o.player_id).filter(Boolean)
  );
  const introEligiblePlayerIds = players
    .filter((p) => !introUsed.has(p.id))
    .map((p) => p.id);

  // Group plans have a weekly cap; private plans grant monthly minutes.
  const groupPlans = plans.filter(
    (p) => p.group_sessions_per_week === null || p.group_sessions_per_week > 0
  );
  const privatePlans = plans.filter((p) => p.group_sessions_per_week === 0);
  const toOption = (p: (typeof plans)[number]) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    price: formatPrice(p.price_pence),
    popular: p.group_sessions_per_week === 2,
  });

  // Account-level trial is usable by any household player.
  const trialNames = summary.hasAccountTrial
    ? players.map((p) => p.full_name)
    : players
        .filter((p) => summary.openTrialPlayerIds.includes(p.id))
        .map((p) => p.full_name);

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

        {/* Free trial — make the gift unmissable and explicit. */}
        {trialNames.length > 0 && (
          <div className="mb-6 rounded-[12px] border border-ember bg-surface-2 p-4">
            <p className="font-display text-xl">
              {trialNames.join(" and ")}&apos;s first group class is free — on
              us. 🏓
            </p>
            <p className="mt-1 text-sm text-fg-2">
              Try a class before you commit to anything. No payment details
              needed.
            </p>
            <Link
              href="/app/book"
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-[8px] bg-ember px-5 font-semibold text-ivory hover:bg-ember-2"
            >
              Book the free trial
            </Link>
          </div>
        )}

        {summary.dropinCredits > 0 && (
          <p className="mb-6 text-sm text-fg-2">
            You have {summary.dropinCredits} unused drop-in{" "}
            {summary.dropinCredits === 1 ? "class" : "classes"} —{" "}
            <Link href="/app/book" className="text-ember underline-offset-4 hover:underline">
              book a session
            </Link>
            .
          </p>
        )}

        {summary.groupPlan && (
          <CurrentPlanCard plan={summary.groupPlan} />
        )}
        {summary.privatePlan && (
          <CurrentPlanCard
            plan={summary.privatePlan}
            minutesBalance={summary.minutesBalance}
          />
        )}

        {!summary.groupPlan?.active && groupPlans.length > 0 && (
          <div className="mb-8">
            <p className="label mb-1">Group memberships</p>
            <p className="mb-3 text-sm text-fg-2">
              A regular weekly routine at your nearest venue. Renews monthly,
              cancel anytime. Members also get member pricing on private
              sessions.
            </p>
            <PlanPicker
              plans={groupPlans.map(toOption)}
              clientName={profile.full_name}
              clientEmail={profile.email}
            />
          </div>
        )}

        {!summary.privatePlan?.active && privatePlans.length > 0 && (
          <div className="mb-8">
            <p className="label mb-1">Private coaching — we come to you</p>
            <p className="mb-3 text-sm text-fg-2">
              One-to-one sessions at your home or clubhouse. Sold as a weekly
              routine, metered in minutes — unused minutes roll over one month.
            </p>
            <PlanPicker
              plans={privatePlans.map(toOption)}
              clientName={profile.full_name}
              clientEmail={profile.email}
            />
          </div>
        )}

        {products.length > 0 && (
          <div className="mb-8">
            <p className="label mb-1">No membership needed</p>
            <p className="mb-3 text-sm text-fg-2">
              Pay for a single class whenever you like — memberships just make
              it cheaper.
            </p>
            <OneOffPicker
              products={products}
              players={players}
              introEligiblePlayerIds={introEligiblePlayerIds}
              isMember={Boolean(summary.groupPlan?.active)}
              clientName={profile.full_name}
              clientEmail={profile.email}
            />
          </div>
        )}

        <p className="mb-8 text-sm text-fg-2">
          Training more seriously? For higher frequencies or a dedicated coach,{" "}
          <a
            href={whatsappLink(
              "Hi Sharwin TT Academy! I'm interested in more intensive coaching for my child — can we talk?"
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ember underline-offset-4 hover:underline"
          >
            talk to us directly
          </a>
          .
        </p>

      </div>
    </ClientShell>
  );
}
