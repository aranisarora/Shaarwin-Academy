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
import { claimAndQueue, markHandled, runCoalescedTurn } from "@/lib/whatsapp/turn";
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

  // Exactly-once AND enqueue, in one INSERT. Claiming the MessageSid before any
  // side effect is old — we ack Twilio instantly and work in after(), so a
  // retry can arrive mid-flight, which is how one "I've arrived" became three
  // replies. What is new is that the claim row now carries the text, so a run
  // already in flight for this chat can absorb this message instead of a second
  // run answering it in parallel. (notification-fix-plan 1.6 + upgrade 3.4.)
  if (!(await claimAndQueue(admin, phone, ev.messageSid, text))) {
    console.info("wa: duplicate inbound", ev.messageSid, "— skipping");
    return;
  }

  // Phone-first identity: resolve, and if the number is genuinely unknown,
  // provision a client account for it (the number is Twilio-verified, so no
  // code or OTP is needed). A DB error must NOT silently degrade to guest.
  const identity = await resolveIdentity(admin, phone);
  let profile = identity.profile;
  if (!profile && identity.reason === "no_account") {
    profile = await autoProvisionClient(admin, phone);
    if (profile) console.info("wa: auto-provisioned client for", phone);
  }
  if (!profile) {
    console.warn("wa: no profile for", phone, "reason", identity.reason);
    // Take it out of the queue. Leaving it there would fold an unanswerable
    // message into somebody's next sentence and act on it a second time.
    await markHandled(admin, [ev.messageSid]);
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
    // STOP is a complete thought on its own — never merged into a burst.
    await markHandled(admin, [ev.messageSid]);
    await sendWhatsApp(phone, reply);
    return;
  }

  const supabase = await userClientFor(profile.email);
  if (!supabase) {
    console.error("wa: session mint failed for", profile.id);
    await markHandled(admin, [ev.messageSid]);
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
      // A tap is deliberate and self-contained: it runs one exact RPC and is
      // never folded into a burst.
      await markHandled(admin, [ev.messageSid]);
      await sendWhatsApp(phone, reply);
      return;
    }
  }

  // Free text (or a non-coach) → the assistant, serialized per chat and over
  // the whole burst rather than this one fragment. Everything below runs while
  // holding the chat lock, so the flood guard and the agent see the same queue.
  await runCoalescedTurn({
    admin,
    phone,
    runId: crypto.randomUUID(),
    handle: async ({ text: burst }, stillCurrent) => {
      // Cheap flood guard, before any LLM spend. Coalescing already softens
      // this — a burst is now one wa_messages row, not five — so what is left
      // here is a genuine flood rather than someone typing quickly.
      const { count } = await admin
        .from("wa_messages")
        .select("id", { count: "exact", head: true })
        .eq("phone", phone)
        .eq("role", "user")
        .gte("created_at", new Date(Date.now() - 60000).toISOString());
      if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
        await sendWhatsApp(phone, "You're messaging faster than I can think — give me a minute 🙂");
        return "answered";
      }

      const reply = await runAgent({
        phone,
        userText: burst,
        profile,
        supabase,
        admin,
        stillCurrent: stillCurrent ?? undefined,
      });
      // null = the run stood down before writing because a correction landed.
      // Say nothing and leave the fragments queued; the next pass answers the
      // whole sentence.
      if (reply === null) return "superseded";

      await sendWhatsApp(phone, reply);
      return "answered";
    },
  });
}

// claimInbound moved to lib/whatsapp/turn.ts as claimAndQueue: the claim row now
// carries the message body, so claiming and queueing are one INSERT and there is
// no window where a message is claimed but not yet visible to a run in flight.
