"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { whatsappLink } from "@/lib/contact";
import { loadRazorpay } from "@/lib/razorpay-checkout";

type PlanOption = {
  id: string;
  name: string;
  description: string;
  price: string;
  popular?: boolean;
};

type CheckoutError =
  | { kind: "offline"; plan: PlanOption } // Razorpay not configured — WhatsApp fallback
  | { kind: "generic" };

export function PlanPicker({
  plans,
  clientName,
  clientEmail,
}: {
  plans: PlanOption[];
  clientName: string;
  clientEmail: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<CheckoutError | null>(null);

  async function checkout(plan: PlanOption) {
    setBusy(plan.id);
    setError(null);

    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: plan.id }),
    });
    const body = await res.json();

    if (!res.ok || !body.subscription_id) {
      setBusy(null);
      setError(
        body.error === "billing_not_configured"
          ? { kind: "offline", plan }
          : { kind: "generic" }
      );
      return;
    }

    const ready = await loadRazorpay();
    if (!ready || !window.Razorpay) {
      setBusy(null);
      setError({ kind: "generic" });
      return;
    }

    const rzp = new window.Razorpay({
      key: body.key_id,
      subscription_id: body.subscription_id,
      name: "Sharwin Table Tennis Academy",
      description: `${plan.name} membership`,
      prefill: body.prefill,
      theme: { color: "#c2410c" },
      handler: async (response) => {
        const verify = await fetch("/api/razorpay/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(response),
        });
        if (verify.ok) {
          window.location.href = "/app/membership?checkout=success";
        } else {
          setBusy(null);
          setError({ kind: "generic" });
        }
      },
      modal: { ondismiss: () => setBusy(null) },
    });
    rzp.open();
  }

  const payMessage = (plan: PlanOption) =>
    `Hi Sharwin TT Academy! I'd like to pay for the ${plan.name} plan ` +
    `(${plan.price}/month). My name is ${clientName} and my account email ` +
    `is ${clientEmail}. Please send me the payment details.`;

  return (
    <div className="space-y-3">
      {plans.map((plan) => (
        <div
          key={plan.id}
          className={`flex items-center justify-between gap-4 rounded-[12px] border bg-surface-2 p-4 ${plan.popular ? "border-ember" : "border-line"}`}
        >
          <div>
            <p className="font-display text-xl">
              {plan.name}
              <span className="tnum ml-2 text-base text-fg-2">
                {plan.price} / month
              </span>
              {plan.popular && (
                <span className="ml-2 rounded-full bg-ember px-2 py-0.5 align-middle text-xs font-semibold text-ivory">
                  Most popular
                </span>
              )}
            </p>
            <p className="text-sm text-fg-2">{plan.description}</p>
          </div>
          <Button onClick={() => checkout(plan)} disabled={busy !== null}>
            {busy === plan.id ? <Spinner /> : "Choose"}
          </Button>
        </div>
      ))}
      {error?.kind === "offline" && (
        <div className="rounded-[12px] border border-err bg-surface-2 p-4">
          <p className="font-medium text-err">
            Online payment isn&apos;t switched on yet
          </p>
          <p className="mt-1 text-sm text-fg-2">
            Pay us directly on WhatsApp instead — we&apos;ll confirm and
            activate your {error.plan.name} membership on this account.
          </p>
          <a
            href={whatsappLink(payMessage(error.plan))}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-ember px-5 font-semibold text-ivory transition-colors duration-200 hover:bg-ember-2"
          >
            Pay via WhatsApp
          </a>
        </div>
      )}
      {error?.kind === "generic" && (
        <p className="text-sm text-err">
          Checkout couldn&apos;t start. Try again in a moment.
        </p>
      )}
    </div>
  );
}
