"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { whatsappLink } from "@/lib/contact";
import { formatPrice } from "@/lib/format";
import { loadRazorpay } from "@/lib/razorpay-checkout";

export type OneOffProduct = {
  id: string;
  name: string;
  description: string | null;
  kind: "group_dropin" | "private_oneoff" | "private_intro";
  price_pence: number;
  member_price_pence: number | null;
};

type CheckoutError =
  | { kind: "offline"; product: OneOffProduct }
  | { kind: "intro_used" }
  | { kind: "generic" };

/**
 * One-off purchases: drop-in group class, private hours, intro promo. Prices
 * come from the server (member pricing applied there); this component only
 * renders and opens Razorpay Checkout with the created order.
 */
export function OneOffPicker({
  products,
  players,
  introEligiblePlayerIds,
  isMember,
  clientName,
  clientEmail,
}: {
  products: OneOffProduct[];
  players: { id: string; full_name: string }[];
  /** Players who haven't used the once-per-child intro promo yet. */
  introEligiblePlayerIds: string[];
  /** Active group plan → member pricing shown. */
  isMember: boolean;
  clientName: string;
  clientEmail: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<CheckoutError | null>(null);
  const [introPlayer, setIntroPlayer] = useState(introEligiblePlayerIds[0] ?? "");

  const eligibleIntroPlayers = players.filter((p) =>
    introEligiblePlayerIds.includes(p.id)
  );

  async function checkout(product: OneOffProduct, playerId?: string) {
    setBusy(product.id);
    setError(null);

    const res = await fetch("/api/checkout/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: product.id, player_id: playerId }),
    });
    const body = await res.json();

    if (!res.ok || !body.order_id) {
      setBusy(null);
      setError(
        body.error === "billing_not_configured"
          ? { kind: "offline", product }
          : body.error === "intro_already_used"
            ? { kind: "intro_used" }
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
      amount: body.amount,
      currency: "INR",
      order_id: body.order_id,
      name: "Sharwin Table Tennis Academy",
      description: product.name,
      prefill: body.prefill,
      theme: { color: "#c2410c" },
      handler: async (response) => {
        const verify = await fetch("/api/razorpay/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(response),
        });
        if (verify.ok) {
          window.location.href =
            product.kind === "group_dropin"
              ? "/app/book?purchase=success"
              : "/app/book/private?purchase=success";
        } else {
          setBusy(null);
          setError({ kind: "generic" });
        }
      },
      modal: { ondismiss: () => setBusy(null) },
    });
    rzp.open();
  }

  const price = (p: OneOffProduct) =>
    isMember && p.member_price_pence !== null && p.member_price_pence < p.price_pence
      ? p.member_price_pence
      : p.price_pence;

  const payMessage = (p: OneOffProduct) =>
    `Hi Sharwin TT Academy! I'd like to pay for "${p.name}" ` +
    `(${formatPrice(price(p))}). My name is ${clientName} and my account email ` +
    `is ${clientEmail}. Please send me the payment details.`;

  return (
    <div className="space-y-3">
      {products.map((product) => {
        const isIntro = product.kind === "private_intro";
        if (isIntro && eligibleIntroPlayers.length === 0) return null;
        const amount = price(product);
        const discounted = amount < product.price_pence;
        return (
          <div
            key={product.id}
            className={`rounded-[12px] border bg-surface-2 p-4 ${isIntro ? "border-ember" : "border-line"}`}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-xl">
                  {product.name}
                  <span className="tnum ml-2 text-base text-fg-2">
                    {discounted && (
                      <s className="mr-1 opacity-60">
                        {formatPrice(product.price_pence)}
                      </s>
                    )}
                    {formatPrice(amount)}
                  </span>
                </p>
                <p className="text-sm text-fg-2">{product.description}</p>
                {isIntro && (
                  <p className="mt-1 text-xs font-semibold text-ember">
                    Promotional offer — one per child, usually{" "}
                    {formatPrice(119900)}.
                  </p>
                )}
                {discounted && !isIntro && (
                  <p className="mt-1 text-xs text-ok">Member price applied.</p>
                )}
              </div>
              <Button
                onClick={() =>
                  checkout(product, isIntro ? introPlayer : undefined)
                }
                disabled={busy !== null || (isIntro && !introPlayer)}
              >
                {busy === product.id ? <Spinner /> : "Buy"}
              </Button>
            </div>
            {isIntro && eligibleIntroPlayers.length > 1 && (
              <div className="mt-3 max-w-56">
                <Select
                  label="For which child?"
                  value={introPlayer}
                  onChange={(e) => setIntroPlayer(e.target.value)}
                >
                  {eligibleIntroPlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        );
      })}
      {error?.kind === "offline" && (
        <div className="rounded-[12px] border border-err bg-surface-2 p-4">
          <p className="font-medium text-err">
            Online payment isn&apos;t switched on yet
          </p>
          <p className="mt-1 text-sm text-fg-2">
            Pay us directly on WhatsApp instead — we&apos;ll confirm and add it
            to your account.
          </p>
          <a
            href={whatsappLink(payMessage(error.product))}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-ember px-5 font-semibold text-ivory transition-colors duration-200 hover:bg-ember-2"
          >
            Pay via WhatsApp
          </a>
        </div>
      )}
      {error?.kind === "intro_used" && (
        <p className="text-sm text-err">
          The intro offer has already been used for that child.
        </p>
      )}
      {error?.kind === "generic" && (
        <p className="text-sm text-err">
          Checkout couldn&apos;t start. Try again in a moment.
        </p>
      )}
    </div>
  );
}
