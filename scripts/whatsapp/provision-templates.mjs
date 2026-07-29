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
 *     TWILIO_WA_COACH_AFTERCLASS_SID=HX... \
 *     TWILIO_WA_CLIENT_REMINDER_SID=HX... TWILIO_WA_CLIENT_WAITLIST_SID=HX... \
 *     TWILIO_WA_CLIENT_PAYMENT_SID=HX... TWILIO_WA_CLIENT_BOOKED_SID=HX... \
 *     TWILIO_WA_COACH_PRIVATE_SID=HX... TWILIO_WA_FOUNDER_DIGEST_SID=HX... \
 *     TWILIO_WA_FOUNDER_SIGNUP_SID=HX... TWILIO_WA_CLIENT_APPROVED_SID=HX... \
 *     TWILIO_WA_COACH_COMING_SID=HX... TWILIO_WA_COACH_ARRIVAL_SID=HX... \
 *     TWILIO_WA_CLIENT_ARRIVED_SID=HX... TWILIO_WA_CLIENT_LATE_SID=HX...
 *
 * Plus ONE template this script cannot create: the generic
 * TWILIO_WA_TEMPLATE_SID (two variables — {{1}} name, {{2}} message) used for
 * any notification with no dedicated template when the user is outside the 24h
 * service window. Build it by hand in the Content Template Builder; without it
 * those sends fail with `outside_24h_window_and_no_generic_template`.
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

// NOTE: the old three-button `coach_class_reminder` template
// (TWILIO_WA_COACH_REMINDER_SID) is deliberately NOT provisioned any more
// (notification-fix-plan 1.4 / G12). The arrival-flow rework split it into two
// one-question prompts — `coach_coming_check` at T-60 and `coach_arrival_check`
// at start — because offering "I've arrived" an hour early trained coaches to
// tap it before leaving home. The worker reads TWILIO_WA_COACH_COMING_SID; a
// template registered under the old name is unreferenced and its env var should
// be removed from the function's secrets.
const TEMPLATES = [
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
        // Lengthened for the same Meta variables-to-length rule as the two
        // coach prompts — "Today at the academy ({{1}}): {{2}}" was refused.
        "twilio/call-to-action": {
          body:
            "Here is your daily summary of activity at Sharwin Table Tennis Academy for {{1}}. Overview of the day: {{2}}. Open the dashboard below for the full breakdown of bookings, cancellations and new clients.",
          actions: [{ type: "URL", title: "Open dashboard", url: `${APP_URL}/admin` }],
        },
        "twilio/text": {
          body: `Your daily summary for Sharwin Table Tennis Academy, {{1}}. Overview of the day: {{2}}. Full breakdown on the dashboard: ${APP_URL}/admin`,
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
  {
    // Coach: "Are you coming?" at T-60 — one question, two buttons. Replaces the
    // three-button coach_class_reminder in the coach flow (arrival-flow-plan).
    key: "TWILIO_WA_COACH_COMING_SID",
    approvalName: "coach_coming_check",
    def: {
      friendly_name: "coach_coming_check",
      language: "en",
      // {{3}} folds time + venue into one value ("6:30 pm at La Plazza").
      variables: { 1: "Augustine", 2: "Beginners Batch", 3: "6:30 pm at La Plazza" },
      types: {
        // Meta rejects a body with too many variables for its length
        // (subCode 2388293) — the terse "Hi {{1}}! {{2}} starts at {{3}}. Are
        // you coming?" was refused. Keep enough literal text around the three
        // variables to clear that ratio.
        "twilio/quick-reply": {
          body:
            "Hi {{1}}, this is a quick check from Sharwin Table Tennis Academy about your upcoming session. Your class {{2}} is scheduled to start at {{3}}. Please let us know whether you are coming, so we can arrange cover in good time if you cannot.",
          actions: [
            { title: "Yes, I'm coming", id: "coach_confirm" },
            { title: "Can't make it", id: "coach_cant" },
          ],
        },
        "twilio/text": {
          body:
            'Hi {{1}}, a quick check about your upcoming session. Your class {{2}} is scheduled to start at {{3}}. Reply "coming" if you are on your way, or "can\'t make it" so we can arrange cover.',
        },
      },
    },
  },
  {
    // Coach: "Have you reached?" at start time — asked only if arrival is still
    // missing. I've arrived / Running late.
    key: "TWILIO_WA_COACH_ARRIVAL_SID",
    approvalName: "coach_arrival_check",
    def: {
      friendly_name: "coach_arrival_check",
      language: "en",
      variables: { 1: "Augustine", 2: "Beginners Batch", 3: "La Plazza" },
      types: {
        // Lengthened for the same Meta variables-to-length rule as
        // coach_coming_check above.
        "twilio/quick-reply": {
          body:
            "Hi {{1}}, your session at Sharwin Table Tennis Academy is about to begin. The class {{2}} is starting now, and we would like to confirm that you have reached {{3}}. Please let us know so we can keep the parents updated.",
          actions: [
            { title: "I've arrived", id: "coach_arrived" },
            { title: "Running late", id: "coach_late" },
          ],
        },
        "twilio/text": {
          body:
            'Hi {{1}}, your session is about to begin. The class {{2}} is starting now — have you reached {{3}}? Reply "arrived" or "running late" so we can keep the parents updated.',
        },
      },
    },
  },
  {
    // Parent: the coach has arrived. No buttons — informational utility message.
    key: "TWILIO_WA_CLIENT_ARRIVED_SID",
    approvalName: "client_coach_arrived",
    def: {
      friendly_name: "client_coach_arrived",
      language: "en",
      variables: { 1: "Priya", 2: "Augustine", 3: "La Plazza", 4: "6:30 pm" },
      types: {
        "twilio/text": {
          body: "Good news {{1}} — Coach {{2}} has arrived at {{3}} for the {{4}} session.",
        },
      },
    },
  },
  {
    // Parent: the coach is running late. No buttons.
    key: "TWILIO_WA_CLIENT_LATE_SID",
    approvalName: "client_coach_late",
    def: {
      friendly_name: "client_coach_late",
      language: "en",
      variables: { 1: "Priya", 2: "Augustine", 3: "6:30 pm" },
      types: {
        "twilio/text": {
          body: "Hi {{1}} — Coach {{2}} is running a few minutes late for the {{3}} session. They're on their way.",
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
