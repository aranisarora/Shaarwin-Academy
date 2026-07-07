import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/lib/razorpay";

/**
 * Razorpay → Postgres mirror. Idempotent via webhook_events unique insert on
 * the x-razorpay-event-id header. Uses the service-role client — webhooks have
 * no user session.
 */
function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

// Razorpay subscription status → our subscription_status enum.
const STATUS_MAP: Record<string, string> = {
  created: "incomplete",
  authenticated: "incomplete",
  active: "active",
  pending: "past_due",
  halted: "past_due",
  cancelled: "canceled",
  completed: "canceled",
  expired: "canceled",
  paused: "paused",
};

type RzpSubscription = {
  id: string;
  status: string;
  current_start: number | null;
  current_end: number | null;
  charge_at: number | null;
  end_at: number | null;
  notes?: Record<string, string> | null;
};

type RzpPayment = {
  id: string;
  amount: number;
  invoice_id: string | null;
};

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || secret.startsWith("whsec_xxx")) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  const valid = await verifyWebhookSignature(raw, signature, secret);
  if (!valid) return NextResponse.json({ error: "bad_signature" }, { status: 400 });

  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId) return NextResponse.json({ error: "no_event_id" }, { status: 400 });

  const event = JSON.parse(raw) as {
    event: string;
    payload: {
      subscription?: { entity: RzpSubscription };
      payment?: { entity: RzpPayment };
    };
  };

  const db = admin();

  // Idempotency first: unique insert; on conflict return 200 and stop.
  const { error: dupe } = await db.from("webhook_events").insert({
    event_id: eventId,
    type: event.event,
    payload: event as unknown as Record<string, unknown>,
  });
  if (dupe) return NextResponse.json({ received: true, duplicate: true });

  try {
    const sub = event.payload.subscription?.entity;
    switch (event.event) {
      case "subscription.activated":
      case "subscription.updated":
      case "subscription.pending":
      case "subscription.halted":
      case "subscription.cancelled":
      case "subscription.completed":
        if (sub) await mirrorSubscription(db, sub);
        break;
      case "subscription.charged":
        if (sub) await mirrorSubscription(db, sub);
        if (sub && event.payload.payment) {
          await handleCharged(db, sub, event.payload.payment.entity);
        }
        break;
    }
    await db
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("event_id", eventId);
  } catch (err) {
    console.error("razorpay webhook handling failed", event.event, err);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mirrorSubscription(db: any, sub: RzpSubscription) {
  const clientId = sub.notes?.supabase_user_id ?? null;
  let planId = sub.notes?.plan_id ?? null;
  if (!clientId) return;

  if (!planId) {
    const { data: existingRow } = await db
      .from("subscriptions")
      .select("plan_id")
      .eq("razorpay_subscription_id", sub.id)
      .maybeSingle();
    planId = existingRow?.plan_id ?? null;
  }
  if (!planId) return;

  const ts = (n: number | null) => (n ? new Date(n * 1000).toISOString() : null);
  const row = {
    client_id: clientId,
    plan_id: planId,
    source: "razorpay",
    razorpay_subscription_id: sub.id,
    status: STATUS_MAP[sub.status] ?? "incomplete",
    current_period_start: ts(sub.current_start),
    current_period_end: ts(sub.current_end),
    cancel_at_period_end: sub.status === "cancelled" && Boolean(sub.end_at),
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await db
    .from("subscriptions")
    .select("id")
    .eq("razorpay_subscription_id", sub.id)
    .maybeSingle();

  if (!existing) {
    await db.from("subscriptions").insert(row);
  } else {
    await db.from("subscriptions").update(row).eq("id", existing.id);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCharged(db: any, sub: RzpSubscription, payment: RzpPayment) {
  const clientId = sub.notes?.supabase_user_id ?? null;
  if (!clientId) return;

  const { data: localSub } = await db
    .from("subscriptions")
    .select("id,plan_id")
    .eq("razorpay_subscription_id", sub.id)
    .maybeSingle();

  // Grant private minutes exactly once per payment (idempotent on invoice row).
  const { data: existing } = await db
    .from("invoices")
    .select("id")
    .eq("razorpay_payment_id", payment.id)
    .maybeSingle();
  if (existing) return;

  await db.from("invoices").insert({
    client_id: clientId,
    subscription_id: localSub?.id ?? null,
    razorpay_payment_id: payment.id,
    amount_pence: payment.amount, // Razorpay amounts are already in paise
    currency: "inr",
    status: "paid",
    paid_at: new Date().toISOString(),
  });

  if (localSub?.plan_id) {
    const { data: plan } = await db
      .from("plans")
      .select("private_minutes_per_quarter")
      .eq("id", localSub.plan_id)
      .maybeSingle();
    if (plan && plan.private_minutes_per_quarter > 0) {
      await db.from("private_credit_ledger").insert({
        client_id: clientId,
        subscription_id: localSub.id,
        delta_minutes: plan.private_minutes_per_quarter,
        reason: "grant",
        note: `razorpay payment ${payment.id}`,
      });
    }
  }
}
