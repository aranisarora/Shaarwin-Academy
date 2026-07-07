"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Razorpay has no hosted customer portal, so "managing billing" for a member
 * means cancelling at the end of the paid quarter. Two-step confirm to avoid
 * an accidental cancel.
 */
export function ManageBillingButton({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/subscription/cancel", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      setConfirming(false);
      return;
    }
    setError("Couldn't cancel right now — please message us on WhatsApp.");
  }

  if (done) {
    return (
      <p className={`text-sm text-fg-2 ${className}`}>
        Your membership will end when the current quarter finishes.
      </p>
    );
  }

  return (
    <div className={className}>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={cancel} disabled={busy} variant="ghost">
            {busy ? <Spinner /> : "Confirm cancel"}
          </Button>
          <button
            onClick={() => setConfirming(false)}
            className="text-sm text-fg-2 underline"
            disabled={busy}
          >
            Keep membership
          </button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)} variant="ghost">
          {label}
        </Button>
      )}
      {error && <p className="mt-2 text-sm text-err">{error}</p>}
    </div>
  );
}
