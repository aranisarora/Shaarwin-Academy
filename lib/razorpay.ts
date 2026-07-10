// Razorpay REST helper — no SDK. Everything we need is a handful of JSON
// endpoints authenticated with HTTP Basic (key_id:key_secret). Mirrors the
// old lib/stripe.ts shape: returns null when unconfigured so builds/deploys
// succeed before keys are set and checkout degrades to the WhatsApp fallback.

const RAZORPAY_API = "https://api.razorpay.com/v1";

export type RazorpayClient = {
  keyId: string;
  post: <T>(path: string, body: Record<string, unknown>) => Promise<T>;
  get: <T>(path: string) => Promise<T>;
};

/** Null when keys are absent or still placeholders. */
export function getRazorpay(): RazorpayClient | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret || keyId.startsWith("rzp_test_xxx")) return null;

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const res = await fetch(`${RAZORPAY_API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`razorpay_${res.status}: ${detail.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  return {
    keyId,
    post: (path, body) => request("POST", path, body),
    get: (path) => request("GET", path),
  };
}

/**
 * Verify a Razorpay webhook signature: HMAC-SHA256(body, webhook_secret) in
 * hex, compared against the X-Razorpay-Signature header.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;
  const { createHmac, timingSafeEqual } = await import("crypto");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Verify the checkout handshake Razorpay Checkout.js posts back on success:
 * HMAC-SHA256(payment_id + "|" + subscription_id, key_secret) hex ==
 * razorpay_signature. Confirms the client isn't spoofing a paid subscription.
 */
export async function verifyPaymentSignature(opts: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
  keySecret: string;
}): Promise<boolean> {
  const { createHmac, timingSafeEqual } = await import("crypto");
  // For subscriptions the order is payment_id + "|" + subscription_id.
  const expected = createHmac("sha256", opts.keySecret)
    .update(`${opts.paymentId}|${opts.subscriptionId}`)
    .digest();
  let given: Buffer;
  try {
    given = Buffer.from(opts.signature, "hex");
  } catch {
    return false;
  }
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Same handshake for one-off Orders: HMAC-SHA256(order_id + "|" + payment_id,
 * key_secret) hex == razorpay_signature. Note the reversed operand order vs
 * subscriptions.
 */
export async function verifyOrderPaymentSignature(opts: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): Promise<boolean> {
  const { createHmac, timingSafeEqual } = await import("crypto");
  const expected = createHmac("sha256", opts.keySecret)
    .update(`${opts.orderId}|${opts.paymentId}`)
    .digest();
  let given: Buffer;
  try {
    given = Buffer.from(opts.signature, "hex");
  } catch {
    return false;
  }
  return expected.length === given.length && timingSafeEqual(expected, given);
}
