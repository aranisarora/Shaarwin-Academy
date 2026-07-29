// Twilio WhatsApp webhook. Auth: every request must carry a valid
// X-Twilio-Signature (HMAC over the exact public URL + params). We ack Twilio
// immediately with empty TwiML and do the LLM work in after(), replying via
// the REST API — webhooks that block on an LLM round-trip hit Twilio's 15s
// timeout.

import { after } from "next/server";
import { runAgent } from "@/lib/whatsapp/agent";
import { handleInteractiveReply } from "@/lib/whatsapp/interactive";
import {
  adminClient,
  autoProvisionClient,
  resolveIdentity,
  userClientFor,
} from "@/lib/whatsapp/identity";
import { applyOptOut, matchOptOut } from "@/lib/whatsapp/optout";
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
  if (!twilioConfigured() || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
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

  // Quick-reply button taps carry the button's payload id + title, and echo the
  // SID of the message they replied to. Handle those deterministically.
  const buttonPayload = (params.ButtonPayload ?? "").trim();
  const buttonText = (params.ButtonText ?? "").trim();
  const originalSid = (params.OriginalRepliedMessageSid ?? "").trim();
  // Twilio's id for THIS inbound message — stable across its retries, which is
  // what lets us process it exactly once (see handleInbound).
  const messageSid = (params.MessageSid ?? params.SmsMessageSid ?? "").trim();

  after(async () => {
    try {
      await handleInbound(phone, {
        body,
        hasMedia: Number(params.NumMedia ?? 0) > 0,
        payload: buttonPayload,
        buttonText,
        originalSid,
        messageSid,
      });
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

/**
 * Handle one inbound WhatsApp event — a tapped quick-reply button OR a typed
 * message. Identity is resolved once, up front.
 *
 * For a coach we first try the deterministic class-action handler on whatever
 * arrived — a button tap OR the words the reminder invites ("coming" /
 * "arrived" / "running late" / "all present") — so those run the exact RPC with
 * no LLM and can't leave the assistant guessing which session was meant. Only
 * genuine free text (and anyone who isn't a coach) reaches the assistant.
 */
async function handleInbound(
  phone: string,
  ev: {
    body: string;
    hasMedia: boolean;
    payload: string;
    buttonText: string;
    originalSid: string;
    messageSid: string;
  }
) {
  const isTap = Boolean(ev.payload || ev.buttonText);
  // A tap carries its label in buttonText; a typed message carries it in body.
  const text = ev.buttonText || ev.body;

  if (!isTap && !ev.body) {
    if (ev.hasMedia) {
      await sendWhatsApp(phone, "I can only read text messages for now — type what you need!");
    }
    return;
  }

  const admin = adminClient();

  // Exactly-once: claim this MessageSid before doing anything with side effects.
  // We ack Twilio instantly and work in after(), so a retry can arrive while the
  // first pass is mid-flight — that's how one "I've arrived" became three
  // replies in production. The primary key makes the claim atomic; the loser of
  // the race just returns. (notification-fix-plan 1.6.)
  if (!(await claimInbound(admin, phone, ev.messageSid))) {
    console.info("wa: duplicate inbound", ev.messageSid, "— skipping");
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

  // Opt-out, ahead of everything else. Before this, a typed "STOP" fell through
  // to the LLM, which answered it conversationally and kept the messages
  // coming. (notification-fix-plan 2.3.)
  const optOut = matchOptOut(text);
  if (optOut) {
    const reply = await applyOptOut(admin, profile.id, optOut);
    await admin.from("wa_messages").insert([
      { phone, role: "user", content: text.slice(0, 4000) },
      { phone, role: "assistant", content: reply.slice(0, 4000) },
    ]);
    await sendWhatsApp(phone, reply);
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

  // Deterministic interactive replies. A coach tap/word, a client button, or a
  // founder Approve/Deny runs the same RPC as the app with no LLM; the handler
  // gates by role and only acts on real taps for clients/founders. Returns null
  // when the message isn't a recognised action, so ordinary chat falls through
  // to the assistant.
  if (profile.role === "coach" || profile.role === "client" || profile.role === "founder") {
    const reply = await handleInteractiveReply({
      admin,
      supabase,
      profile,
      payload: ev.payload,
      text,
      originalSid: ev.originalSid,
    });
    if (reply !== null) {
      await admin.from("wa_messages").insert([
        { phone, role: "user", content: (text || ev.payload).slice(0, 4000) },
        { phone, role: "assistant", content: reply.slice(0, 4000) },
      ]);
      await sendWhatsApp(phone, reply);
      return;
    }
  }

  // Free text (or a non-coach) → the assistant. Cheap flood guard first, before
  // any LLM spend.
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

  const reply = await runAgent({ phone, userText: text, profile, supabase, admin });
  await sendWhatsApp(phone, reply);
}

/**
 * Claim an inbound MessageSid. Returns true if this request is the first to see
 * it (proceed) and false if it's a Twilio retry of something we already handled
 * (ack and drop).
 *
 * Fails OPEN on an unexpected DB error: a dropped message is worse than a rare
 * double reply, and the only DB error we expect here is the duplicate-key one we
 * explicitly look for. A missing sid (shouldn't happen — Twilio always sends
 * one) also proceeds rather than swallowing the message.
 */
async function claimInbound(
  admin: ReturnType<typeof adminClient>,
  phone: string,
  messageSid: string
): Promise<boolean> {
  if (!messageSid) return true;
  const { error } = await admin.from("wa_inbound_seen").insert({ message_sid: messageSid, phone });
  if (!error) return true;
  // 23505 = unique_violation → someone else already claimed this sid.
  if (error.code === "23505") return false;
  console.warn("wa: inbound claim failed, processing anyway", error.message);
  return true;
}
