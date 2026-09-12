import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyOrderPaymentSignature, verifyPaymentSignature } from "@/lib/razorpay";

/**
 * Called by the browser when the Razorpay Checkout modal reports success —
 * for subscriptions (razorpay_subscription_id) and one-off orders
 * (razorpay_order_id) alike. Verifies the handshake signature so a client
 * can't fake activation, then lets the page redirect. Authoritative state
 * still comes from the webhook.
 */
export async function POST(request: Request) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_order_id,
    razorpay_signature,
  } = (await request.json()) as {
    razorpay_payment_id?: string;
    razorpay_subscription_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  };

  if (!razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  let valid = false;
  if (razorpay_subscription_id) {
    valid = await verifyPaymentSignature({
      paymentId: razorpay_payment_id,
      subscriptionId: razorpay_subscription_id,
      signature: razorpay_signature,
      keySecret,
    });
  } else if (razorpay_order_id) {
    valid = await verifyOrderPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      keySecret,
    });
  } else {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  if (!valid) return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
