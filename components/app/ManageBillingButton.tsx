"use client";

import { useState } from "react";
import { ConfirmAction } from "@/components/ui/ConfirmAction";

/**
 * Razorpay has no hosted customer portal, so "managing billing" for a member
 * means cancelling at the end of the paid month. Two-step confirm to avoid an
 * accidental cancel. `planId` picks which subscription when the household
 * holds both a group and a private plan.
 */
export function ManageBillingButton({
  label,
  planId,
  className = "",
}: {
  label: string;
  planId?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/subscription/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: planId }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      return;
    }
    setError("Couldn't cancel right now — please message us on WhatsApp.");
  }

  if (done) {
    return (
      <p className={`text-sm text-fg-2 ${className}`}>
        Your membership will end when the current month finishes.
      </p>
    );
  }

  return (
    <div className={className}>
      <ConfirmAction
        variant="ghost"
        fullWidth={false}
        label={label}
        prompt="Cancel your membership? It stays active until the end of the month you've already paid for."
        confirmLabel="Confirm cancel"
        keepLabel="Keep membership"
        pending={busy}
        onConfirm={cancel}
      />
      {error && <p className="mt-2 text-sm text-err">{error}</p>}
    </div>
  );
}
