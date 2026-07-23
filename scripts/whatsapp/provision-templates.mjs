/**
 * The single registry of every interactive/CTA Content template the academy
 * sends over WhatsApp — coach class prompts, client reminders/waitlist/payment/
 * booking messages, the coach private-session CTA and the founder daily digest.
 * Creates each and submits it for WhatsApp approval as a UTILITY template.
 * Idempotent: re-running reuses a template that already exists with the same
 * friendly_name.
 *
 * The button `id`s here MUST stay in sync with lib/whatsapp/interactive.ts, and
 * the variable order MUST match interactiveContentFor() in
 * supabase/functions/notify/index.ts.
 *
 * WhatsApp template rules the definitions obey: no adjacent variables, no
 * variable at the very start/end of a body, no emojis/formatting/newlines in
 * button titles, no newlines in variable values at send time.
 *
 * Requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN in .env.local.
 * Usage: npm run wa:provision   (or: node scripts/whatsapp/provision-templates.mjs)
 *
 * After approval (check the Twilio Console → Messaging → Content Template
 * Builder), set the printed SIDs on the Supabase edge function:
 *   supabase secrets set \
 *     TWILIO_WA_COACH_REMINDER_SID=HX... TWILIO_WA_COACH_AFTERCLASS_SID=HX... \
 *     TWILIO_WA_CLIENT_REMINDER_SID=HX... TWILIO_WA_CLIENT_WAITLIST_SID=HX... \
 *     TWILIO_WA_CLIENT_PAYMENT_SID=HX... TWILIO_WA_CLIENT_BOOKED_SID=HX... \
 *     TWILIO_WA_COACH_PRIVATE_SID=HX... TWILIO_WA_FOUNDER_DIGEST_SID=HX... \
 *     TWILIO_WA_FOUNDER_SIGNUP_SID=HX... TWILIO_WA_CLIENT_APPROVED_SID=HX...
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const SID = env.TWILIO_ACCOUNT_SID;
const TOKEN = env.TWILIO_AUTH_TOKEN;
if (!SID || !TOKEN) {
  console.error("Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.local first.");
  process.exit(1);
}
const auth = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");
// Base URL for CTA button deep links. Keep in sync with APP_URL on the worker.
const APP_URL = (env.APP_URL || env.NEXT_PUBLIC_APP_URL || "https://sharwinacademy.com").replace(/\/$/, "");

async function api(method, path, body) {
  const res = await fetch(`https://content.twilio.com${path}`, {
    method,
    headers: {
      Authorization: auth,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

/** Find an existing Content template by friendly_name, paging as needed. */
async function findByName(name) {
  let url = "/v1/Content?PageSize=50";
  for (let i = 0; i < 40 && url; i++) {
    const { ok, json } = await api("GET", url);
    if (!ok) break;
    const hit = (json.contents ?? []).find((c) => c.friendly_name === name);
    if (hit) return hit.sid;
    url = json.meta?.next_page_url ? json.meta.next_page_url.replace("https://content.twilio.com", "") : null;
  }
  return null;
}

async function ensureTemplate(def) {
  const existing = await findByName(def.friendly_name);
  if (existing) {
    console.log(`• ${def.friendly_name}: already exists (${existing})`);
    return existing;
  }
  const { ok, status, json } = await api("POST", "/v1/Content", def);
  if (!ok) {
    console.error(`✗ ${def.friendly_name}: create failed (${status})`, json);
    return null;
  }
  console.log(`✓ ${def.friendly_name}: created (${json.sid})`);
  return json.sid;
}

/** Submit the template for WhatsApp approval as a UTILITY template. */
async function requestApproval(sid, name) {
  const { ok, status, json } = await api(
    "POST",
    `/v1/Content/${sid}/ApprovalRequests/whatsapp`,
    { name, category: "UTILITY" }
  );
  if (ok) {
    console.log(`  ↳ approval submitted (${json.whatsapp?.status ?? "received"})`);
  } else if (status === 409 || /already/i.test(JSON.stringify(json))) {
    console.log("  ↳ approval already requested");
  } else {
    console.error(`  ↳ approval request failed (${status})`, json);
  }
}

const TEMPLATES = [
  {
    key: "TWILIO_WA_COACH_REMINDER_SID",
    approvalName: "coach_class_reminder",
    def: {
      friendly_name: "coach_class_reminder",
      language: "en",
      // {{3}} folds time + venue into one value ("6:30 pm at La Plazza"):
      // WhatsApp disallows variables that are adjacent, or at the start/end.
      variables: { 1: "Augustine", 2: "Beginners Batch", 3: "6:30 pm at La Plazza" },
      types: {
        "twilio/quick-reply": {
          body:
            "Hi {{1}} 👋 Reminder: your class *{{2}}* starts at {{3}}. Tap a button below to keep us posted — see you on court!",
          actions: [
            { title: "I'm coming", id: "coach_confirm" },
            { title: "I've arrived", id: "coach_arrived" },
            { title: "Running late", id: "coach_late" },
          ],
        },
        "twilio/text": {
          body:
            'Hi {{1}}! Reminder: {{2}} starts at {{3}}. Reply "coming", "arrived", or "running late" to keep us posted.',
        },
      },
    },
  },
  {
    key: "TWILIO_WA_COACH_AFTERCLASS_SID",
    approvalName: "coach_class_complete",
    def: {
      friendly_name: "coach_class_complete",
      language: "en",
      variables: {
        1: "Beginners Batch",
        2: "Up next today: Improvers at 7:30 pm.",
        3: "https://sharwinacademy.com/coach/session/0000",
      },
      types: {
        "twilio/quick-reply": {
          // Body can't start or end with a variable → trailing text after {{3}}.
          body:
            "🎉 Great work wrapping up *{{1}}*! {{2}} Please confirm today's attendance and add a quick assessment note for each student here: {{3}} — thank you! 🙌",
          // WhatsApp button titles can't contain emojis/newlines/formatting.
          actions: [
            { title: "All present", id: "ac_present" },
            { title: "Some absent", id: "ac_absent" },
          ],
        },
        "twilio/text": {
          body: "Great work finishing {{1}}! {{2}} Confirm attendance & add notes: {{3}} — thank you!",
        },
      },
    },
  },
  {
    key: "TWILIO_WA_CLIENT_REMINDER_SID",
    approvalName: "client_session_reminder",
    def: {
      friendly_name: "client_session_reminder",
      language: "en",
      variables: { 1: "Priya", 2: "Beginners Batch", 3: "6:30 pm" },
      types: {
        "twilio/quick-reply": {
          body: "Hi {{1}}! Reminder: {{2}} is on today at {{3}}. See you at the table!",
          actions: [
            { title: "I'll be there", id: "rem_yes" },
            { title: "Can't make it", id: "rem_no" },
          ],
        },
        "twilio/text": {
          body: 'Hi {{1}}! Reminder: {{2}} is on today at {{3}}. Reply "yes" to confirm or "no" if you can\'t make it.',
        },
      },
    },
  },
  {
    key: "TWILIO_WA_CLIENT_WAITLIST_SID",
    approvalName: "client_waitlist_spot",
    def: {
      friendly_name: "client_waitlist_spot",
      language: "en",
      variables: { 1: "Priya", 2: "Beginners Batch", 3: "15" },
      types: {
        "twilio/quick-reply": {
          body: "Good news {{1}} — a spot just opened in {{2}}. First to claim it gets it (offer expires in {{3}} minutes).",
          actions: [
            { title: "Claim spot", id: "wl_claim" },
            { title: "Pass", id: "wl_pass" },
          ],
        },
        "twilio/text": {
          body: 'Good news {{1}} — a spot just opened in {{2}}. Reply "claim" within {{3}} minutes to take it.',
        },
      },
    },
  },
  {
    key: "TWILIO_WA_CLIENT_PAYMENT_SID",
    approvalName: "client_payment_issue",
    def: {
      friendly_name: "client_payment_issue",
      language: "en",
      variables: { 1: "Priya", 2: "your membership" },
      types: {
        "twilio/call-to-action": {
          body: "Hi {{1}}, your last payment for {{2}} didn't go through. Please update your payment method to keep sessions running.",
          actions: [{ type: "URL", title: "Fix payment", url: `${APP_URL}/app/billing` }],
        },
        "twilio/text": {
          body: `Hi {{1}}, your last payment for {{2}} didn't go through. Update your payment method to keep sessions running: ${APP_URL}/app/billing`,
        },
      },
    },
  },
  {
    key: "TWILIO_WA_CLIENT_BOOKED_SID",
    approvalName: "client_booking_confirmed",
    def: {
      friendly_name: "client_booking_confirmed",
      language: "en",
      variables: { 1: "Priya", 2: "Sat 12 Jul, 6:30 pm — Beginners Batch" },
      types: {
        "twilio/call-to-action": {
          body: "You're booked, {{1}}! {{2}} — see it anytime on your schedule.",
          actions: [{ type: "URL", title: "View schedule", url: `${APP_URL}/app/schedule` }],
        },
        "twilio/text": {
          body: `You're booked, {{1}}! {{2}} — see it anytime on your schedule: ${APP_URL}/app/schedule`,
        },
      },
    },
  },
  {
    key: "TWILIO_WA_COACH_PRIVATE_SID",
    approvalName: "coach_private_session",
    def: {
      friendly_name: "coach_private_session",
      language: "en",
      // {{3}} is the session id, appended to the CTA URL (Twilio allows one
      // trailing variable on a CTA button URL).
      variables: { 1: "Augustine", 2: "Sat 12 Jul, 6:30 pm — 21 MG Road", 3: "0000" },
      types: {
        "twilio/call-to-action": {
          body: "New private session, {{1}}: {{2}}. Tap below for the address and details.",
          actions: [
            { type: "URL", title: "View session", url: `${APP_URL}/coach/session/{{3}}` },
          ],
        },
        "twilio/text": {
          body: `New private session, {{1}}: {{2}}. Details: ${APP_URL}/coach/session/{{3}}`,
        },
      },
    },
  },
  {
    key: "TWILIO_WA_FOUNDER_DIGEST_SID",
    approvalName: "founder_daily_digest",
    def: {
      friendly_name: "founder_daily_digest",
      language: "en",
      variables: { 1: "2026-07-23", 2: "12 bookings · 2 cancellations · 1 new client" },
      types: {
        "twilio/call-to-action": {
          body: "Today at the academy ({{1}}): {{2}}",
          actions: [{ type: "URL", title: "Open dashboard", url: `${APP_URL}/admin` }],
        },
        "twilio/text": {
          body: `Today at the academy ({{1}}): {{2}} — ${APP_URL}/admin`,
        },
      },
    },
  },
  {
    // Founder: a new closed-membership signup request with Approve / Deny.
    key: "TWILIO_WA_FOUNDER_SIGNUP_SID",
    approvalName: "founder_signup_request",
    def: {
      friendly_name: "founder_signup_request",
      language: "en",
      variables: { 1: "Priya Sharma", 2: "priya@example.com", 3: "+91 98123 45678" },
      types: {
        "twilio/quick-reply": {
          body: "New signup request from {{1}} — email {{2}}, phone {{3}}. Approve access to the academy?",
          actions: [
            { title: "Approve", id: "su_approve" },
            { title: "Deny", id: "su_deny" },
          ],
        },
        "twilio/text": {
          body: "New signup request from {{1}} — email {{2}}, phone {{3}}. Review it in the admin app to approve or deny.",
        },
      },
    },
  },
  {
    // Client: their membership request was approved → CTA into the app.
    key: "TWILIO_WA_CLIENT_APPROVED_SID",
    approvalName: "client_signup_approved",
    def: {
      friendly_name: "client_signup_approved",
      language: "en",
      variables: { 1: "Priya" },
      types: {
        "twilio/call-to-action": {
          body: "Great news {{1}} — your Sharwin TTA membership request is approved. Tap below to set up your family and book your first session.",
          actions: [{ type: "URL", title: "Open the app", url: `${APP_URL}/app` }],
        },
        "twilio/text": {
          body: `Great news {{1}} — your Sharwin TTA membership request is approved. Set up your family and book your first session: ${APP_URL}/app`,
        },
      },
    },
  },
];

const results = {};
for (const t of TEMPLATES) {
  const sid = await ensureTemplate(t.def);
  if (sid) {
    await requestApproval(sid, t.approvalName);
    results[t.key] = sid;
  }
}

console.log("\nSet these on the Supabase edge function once approved:\n");
for (const [key, sid] of Object.entries(results)) {
  console.log(`  ${key}=${sid}`);
}
console.log(
  "\n  supabase secrets set " +
    Object.entries(results)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ") +
    "\n\nApproval is asynchronous — track it in the Twilio Console. Until the SIDs" +
    "\nare set the coach prompts still send as plain text (and typed replies like" +
    '\n"arrived" work too).'
);
