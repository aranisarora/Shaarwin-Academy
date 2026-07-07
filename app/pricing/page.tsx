import type { Metadata } from "next";
import { StageShell } from "@/components/shells/StageShell";
import { ButtonLink } from "@/components/ui/Button";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { getPlans, formatPrice } from "@/lib/data";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Quarterly membership for group classes and private coaching. Billed plainly, cancel any time.",
};

function entitlements(plan: {
  group_sessions_per_week: number | null;
  private_minutes_per_quarter: number;
}): string[] {
  const lines: string[] = [];
  lines.push(
    plan.group_sessions_per_week === null
      ? "Unlimited group sessions"
      : `Up to ${plan.group_sessions_per_week} group sessions a week`
  );
  if (plan.private_minutes_per_quarter > 0) {
    lines.push(
      `${plan.private_minutes_per_quarter} minutes of private coaching at your home each quarter`
    );
  }
  lines.push("Book, reschedule and cancel from the app");
  return lines;
}

export default async function PricingPage() {
  const plans = await getPlans();

  return (
    <StageShell>
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-28">
        <p className="label mb-3">Pricing</p>
        <h1 className="font-display mb-4 text-4xl md:text-6xl">
          One quarterly payment
        </h1>
        <p className="mb-12 max-w-md text-lg text-smoke">
          Billed every three months. No joining fee, no asterisks.
        </p>

        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((plan, i) => (
            <div
              key={plan.id}
              className={`flex h-full flex-col rounded-[12px] border bg-ink-2 p-6 ${
                i === 1 ? "border-ember" : "border-line"
              }`}
            >
              {i === 1 && <p className="label mb-2 !text-ember">Most popular</p>}
              <h2 className="font-display text-2xl">{plan.name}</h2>
              <p className="font-display tnum mt-3 text-5xl">
                {formatPrice(plan.price_pence)}
                <span className="ml-1 font-ui text-sm text-smoke">/ quarter</span>
              </p>
              <ul className="mt-6 flex-1 space-y-3">
                {entitlements(plan).map((line) => (
                  <li key={line} className="flex gap-3 text-sm text-smoke">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ember" />
                    {line}
                  </li>
                ))}
              </ul>
              <ButtonLink
                href={`/signup?plan=${plan.id}`}
                variant={i === 1 ? "primary" : "ghost"}
                className="mt-8"
              >
                Choose {plan.name}
              </ButtonLink>
            </div>
          ))}
          {plans.length === 0 && (
            <p className="text-smoke">Plans are being set up — check back shortly.</p>
          )}
        </div>

        <SectionDivider className="my-16" />

        <div className="max-w-xl">
          <h2 className="font-display mb-3 text-2xl">Cancelling</h2>
          <p className="text-smoke">
            Cancel any time from your membership screen. Your access — sessions,
            bookings and private minutes — runs to the end of the quarter
            you&apos;ve paid for. Nothing renews after that.
          </p>
        </div>
      </div>
    </StageShell>
  );
}
