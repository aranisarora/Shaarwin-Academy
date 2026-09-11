/**
 * The forwarding address for the academy's old WhatsApp number.
 *
 * This endpoint used to be the whole assistant: an LLM agent with database
 * access that booked, cancelled and answered. All of that moved to bluetick, on
 * a new number. What is left here is the one thing the old number still owes
 * anyone who messages it — a sentence saying where the academy went, and a link
 * that opens a thread with it.
 *
 * Point Twilio's inbound webhook for the old number at this route. It reads
 * nothing, writes nothing, and needs no database.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { whatsappLink } from "@/lib/contact";

function forwardingMessage(): string {
  // The same link every button on the site opens: the sentence, then the
  // workspace key as "With my code: …", so the assistant knows which business
  // the sender means.
  return `Sharwin Academy has moved to a new WhatsApp number. Tap to continue: ${whatsappLink()}`;
}

/** Escape the five XML entities — the message is interpolated into TwiML. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Validate X-Twilio-Signature: HMAC-SHA1 (base64) over the full public URL with
 * the form params appended in sorted-key order. Ported from the deleted
 * lib/whatsapp/twilio.ts, which was the only other thing that used it.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
function validateTwilioSignature(
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

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const params: Record<string, string> = {};
  for (const [key, value] of form?.entries() ?? []) {
    if (typeof value === "string") params[key] = value;
  }

  // Twilio signs the URL it was configured with. Behind a proxy the request's
  // own host can differ, so rebuild it from the public app URL when we have one.
  const configuredUrl = process.env.WHATSAPP_WEBHOOK_URL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const publicUrl =
    configuredUrl ?? (appUrl ? `${appUrl}/api/whatsapp` : request.url);

  // No auth token configured means we cannot tell Twilio from anyone else, and
  // this endpoint will not speak to strangers.
  if (
    !validateTwilioSignature(
      publicUrl,
      params,
      request.headers.get("x-twilio-signature")
    )
  ) {
    return new Response("invalid signature", { status: 403 });
  }

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(
      forwardingMessage()
    )}</Message></Response>`,
    { headers: { "Content-Type": "text/xml; charset=utf-8" } }
  );
}

export function GET() {
  return new Response("method not allowed", { status: 405 });
}
