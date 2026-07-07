import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyPaymentSignature } from "@/lib/razorpay";

/**
 * Called by the browser when the Razorpay Checkout modal reports success.
 * Verifies the handshake signature so a client can't fake activation, then
 * lets the page redirect. Authoritative state still comes from the webhook.
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
    razorpay_signature,
  } = (await request.json()) as {
    razorpay_payment_id?: string;
    razorpay_subscription_id?: string;
    razorpay_signature?: string;
  };

  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const valid = await verifyPaymentSignature({
    paymentId: razorpay_payment_id,
    subscriptionId: razorpay_subscription_id,
    signature: razorpay_signature,
    keySecret,
  });

  if (!valid) return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
