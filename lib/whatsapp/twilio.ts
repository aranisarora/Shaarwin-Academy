// Twilio WhatsApp transport — outbound sends + inbound webhook authentication.
// No SDK: the REST surface we need is one endpoint and one HMAC.

import { createHmac, timingSafeEqual } from "crypto";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

// WhatsApp hard limit is 1600 chars per message.
const MAX_BODY = 1550;

export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
  );
}

/** "whatsapp:+9198..." → "+9198..." */
export function stripWhatsappPrefix(address: string): string {
  return address.replace(/^whatsapp:/, "");
}

/**
 * Send a WhatsApp message via the Twilio REST API. Long replies are split on
 * paragraph boundaries to stay under the 1600-char WhatsApp limit.
 */
export async function sendWhatsApp(
  toPhone: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  if (!twilioConfigured()) return { ok: false, error: "twilio_not_configured" };

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_FROM!; // e.g. "whatsapp:+14155238886"
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  for (const chunk of splitMessage(body)) {
    const res = await fetch(`${TWILIO_API}/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from,
        To: `whatsapp:${toPhone}`,
        Body: chunk,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("twilio send failed", res.status, detail.slice(0, 500));
      return { ok: false, error: `twilio_${res.status}` };
    }
  }
  return { ok: true };
}

function splitMessage(body: string): string[] {
  const text = body.trim();
  if (text.length <= MAX_BODY) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > MAX_BODY) {
    // Prefer breaking on a blank line, then a newline, then hard cut.
    let cut = rest.lastIndexOf("\n\n", MAX_BODY);
    if (cut < MAX_BODY / 2) cut = rest.lastIndexOf("\n", MAX_BODY);
    if (cut < MAX_BODY / 2) cut = MAX_BODY;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Validate X-Twilio-Signature on an inbound webhook: HMAC-SHA1(base64) over
 * the full URL + form params concatenated in sorted-key order.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;

  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");

  const expected = createHmac("sha1", token).update(data, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return expected.length === given.length && timingSafeEqual(expected, given);
}
