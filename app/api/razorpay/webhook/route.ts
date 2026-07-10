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
  order_id?: string | null;
  notes?: Record<string, string> | null;
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
      case "payment.captured":
        // One-off purchases (drop-in, private hours, intro promo) — web
        // checkout (orders table) and WhatsApp payment links (notes) both
        // land here. Subscription charges also emit this event; they carry
        // no matching order row or product note and fall through.
        if (event.payload.payment) {
          await handleOneOffPayment(db, event.payload.payment.entity);
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
      .select("private_minutes_per_cycle")
      .eq("id", localSub.plan_id)
      .maybeSingle();
    if (plan && plan.private_minutes_per_cycle > 0) {
      await db.from("private_credit_ledger").insert({
        client_id: clientId,
        subscription_id: localSub.id,
        delta_minutes: plan.private_minutes_per_cycle,
        reason: "grant",
        note: `razorpay payment ${payment.id}`,
      });

      // Rollover cap: unused minutes carry over at most one extra cycle, so
      // the balance never exceeds two months' worth. Excess expires here.
      const cap = plan.private_minutes_per_cycle * 2;
      const { data: balance } = await db.rpc("private_minutes_balance", {
        p_client: clientId,
      });
      if (typeof balance === "number" && balance > cap) {
        await db.from("private_credit_ledger").insert({
          client_id: clientId,
          subscription_id: localSub.id,
          delta_minutes: cap - balance,
          reason: "expiry",
          note: "rollover cap (max one cycle carried over)",
        });
      }
    }
  }
}

/**
 * Fulfil a one-off purchase. The order is resolved from our orders table
 * (web checkout) or from the payment's notes (WhatsApp payment links, which
 * create their own Razorpay order we never see). Idempotent via the unique
 * invoices.razorpay_payment_id insert.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleOneOffPayment(db: any, payment: RzpPayment) {
  let clientId: string | null = null;
  let productId: string | null = null;
  let playerId: string | null = null;
  let localOrderId: string | null = null;

  if (payment.order_id) {
    const { data: order } = await db
      .from("orders")
      .select("id,client_id,player_id,product_id")
      .eq("razorpay_order_id", payment.order_id)
      .maybeSingle();
    if (order) {
      clientId = order.client_id;
      productId = order.product_id;
      playerId = order.player_id;
      localOrderId = order.id;
    }
  }
  if (!clientId && payment.notes?.product_id && payment.notes?.supabase_user_id) {
    clientId = payment.notes.supabase_user_id;
    productId = payment.notes.product_id;
    playerId = payment.notes.player_id || null;
  }
  if (!clientId || !productId) return; // not one of ours (e.g. a subscription charge)

  // Idempotency: the unique partial index on invoices.razorpay_payment_id
  // makes the second delivery a no-op.
  const { error: dupe } = await db.from("invoices").insert({
    client_id: clientId,
    razorpay_payment_id: payment.id,
    amount_pence: payment.amount,
    currency: "inr",
    status: "paid",
    paid_at: new Date().toISOString(),
  });
  if (dupe) return;

  if (localOrderId) {
    await db
      .from("orders")
      .update({
        status: "paid",
        razorpay_payment_id: payment.id,
        paid_at: new Date().toISOString(),
      })
      .eq("id", localOrderId);
  } else if (payment.order_id) {
    // Payment-link path: record the order so per-child promos stay traceable.
    const { data: inserted } = await db
      .from("orders")
      .insert({
        client_id: clientId,
        player_id: playerId,
        product_id: productId,
        razorpay_order_id: payment.order_id,
        razorpay_payment_id: payment.id,
        amount_pence: payment.amount,
        currency: "inr",
        status: "paid",
        paid_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    localOrderId = inserted?.id ?? null;
  }

  const { data: product } = await db
    .from("products")
    .select("id,kind,grants_minutes,name")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return;

  if (product.kind === "group_dropin") {
    await db.from("class_credits").insert({
      client_id: clientId,
      player_id: playerId,
      type: "group_dropin",
      source: "purchase",
      order_id: localOrderId,
      note: `razorpay payment ${payment.id}`,
    });
  } else if (product.grants_minutes > 0) {
    await db.from("private_credit_ledger").insert({
      client_id: clientId,
      delta_minutes: product.grants_minutes,
      reason: "grant",
      note: `${product.name} — razorpay payment ${payment.id}`,
    });
  }
}
