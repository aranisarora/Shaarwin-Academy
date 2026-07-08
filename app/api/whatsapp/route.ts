// Twilio WhatsApp webhook. Auth: every request must carry a valid
// X-Twilio-Signature (HMAC over the exact public URL + params). We ack Twilio
// immediately with empty TwiML and do the LLM work in after(), replying via
// the REST API — webhooks that block on an LLM round-trip hit Twilio's 15s
// timeout.

import { after } from "next/server";
import { runAgent } from "@/lib/whatsapp/agent";
import {
  adminClient,
  autoProvisionClient,
  resolveIdentity,
  userClientFor,
} from "@/lib/whatsapp/identity";
import { normalizePhone } from "@/lib/whatsapp/phone";
import {
  sendWhatsApp,
  stripWhatsappPrefix,
  twilioConfigured,
  validateTwilioSignature,
} from "@/lib/whatsapp/twilio";

const EMPTY_TWIML = new Response(
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  { headers: { "Content-Type": "text/xml" } }
);

const RATE_LIMIT_PER_MINUTE = 12;

export async function POST(request: Request) {
  if (!twilioConfigured() || !process.env.GEMINI_API_KEY) {
    return new Response("not configured", { status: 503 });
  }

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  // Twilio signs the URL it was configured with — behind a proxy the request
  // URL's host can differ, so rebuild it from the public app URL.
  const publicUrl =
    process.env.WHATSAPP_WEBHOOK_URL ??
    `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/api/whatsapp`;
  const valid = validateTwilioSignature(
    publicUrl,
    params,
    request.headers.get("x-twilio-signature")
  );
  if (!valid) {
    console.warn("wa: rejected webhook with bad signature");
    return new Response("invalid signature", { status: 403 });
  }

  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();
  if (!from.startsWith("whatsapp:")) return EMPTY_TWIML;
  const phone = normalizePhone(stripWhatsappPrefix(from));
  if (!phone) {
    console.warn("wa: unparseable sender", from);
    return EMPTY_TWIML;
  }

  after(async () => {
    try {
      await handleMessage(phone, body, Number(params.NumMedia ?? 0) > 0);
    } catch (err) {
      console.error("wa: message handling failed", err);
      await sendWhatsApp(
        phone,
        "Something went wrong on our side — please try that again in a minute."
      );
    }
  });

  return EMPTY_TWIML;
}

async function handleMessage(phone: string, body: string, hasMedia: boolean) {
  if (!body) {
    if (hasMedia) {
      await sendWhatsApp(phone, "I can only read text messages for now — type what you need!");
    }
    return;
  }

  const admin = adminClient();

  // Cheap flood guard before any LLM spend.
  const { count } = await admin
    .from("wa_messages")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .eq("role", "user")
    .gte("created_at", new Date(Date.now() - 60000).toISOString());
  if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
    await sendWhatsApp(phone, "You're messaging faster than I can think — give me a minute 🙂");
    return;
  }

  // Phone-first identity: resolve, and if the number is genuinely unknown,
  // provision a client account for it (the number is Twilio-verified, so no
  // code or OTP is needed). A DB error must NOT silently degrade to guest.
  const identity = await resolveIdentity(admin, phone);
  let profile = identity.profile;
  if (!profile && identity.reason === "not_linked") {
    profile = await autoProvisionClient(admin, phone);
    if (profile) console.info("wa: auto-provisioned client for", phone);
  }
  if (!profile) {
    console.warn("wa: no profile for", phone, "reason", identity.reason);
    await sendWhatsApp(
      phone,
      "I'm having trouble reaching your account right now — please try again in a minute."
    );
    return;
  }

  const supabase = await userClientFor(profile.email);
  if (!supabase) {
    console.error("wa: session mint failed for", profile.id);
    await sendWhatsApp(
      phone,
      "I couldn't securely access your account just now. Please try again in a minute."
    );
    return;
  }

  const reply = await runAgent({ phone, userText: body, profile, supabase, admin });
  await sendWhatsApp(phone, reply);
}
