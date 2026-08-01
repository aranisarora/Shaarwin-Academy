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
/**
 * Base URL for CTA button deep links. Keep in sync with APP_URL on the worker.
 *
 * This deliberately does NOT read NEXT_PUBLIC_APP_URL. It used to, and that is
 * how five approved templates shipped with `http://localhost:3000` baked into
 * their buttons — including "Fix payment" on the card-declined message. The
 * value is frozen into the template at creation and a Content template cannot
 * be edited, so the only repair is delete + recreate + re-approve.
 *
 * NEXT_PUBLIC_APP_URL itself is fine — Vercel sets it to the real origin. The
 * trap is that this script reads `.env.local` off the filesystem, so it only
 * ever sees the *local* value and never Vercel's. On a developer's machine that
 * is `http://localhost:3000`, so reading it here is guaranteed to get the dev
 * URL no matter how production is configured. A template is always a production
 * artifact, so it gets its own explicit override and defaults to production.
 *
 * The lesson generalises: a URL passed as a template *variable* is resolved at
 * send time by the worker and is safe; a URL sitting in a button `url:` is
 * frozen at provision time. Prefer the former where the template allows it.
 */
const APP_URL = (env.WA_TEMPLATE_APP_URL || "https://sharwinacademy.com").replace(/\/$/, "");
if (!/^https:\/\//.test(APP_URL) || /localhost|127\.0\.0\.1/.test(APP_URL)) {
  console.error(
    `Refusing to provision templates against ${APP_URL}.\n` +
      "Button URLs are frozen into the template forever and cannot be edited.\n" +
      "Set WA_TEMPLATE_APP_URL to the public https origin, or leave it unset."
  );
  process.exit(1);
}

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

/**
 * Submit the template for WhatsApp approval as a UTILITY template.
 *
 * `allow_category_change: false` is the load-bearing part. Meta re-categorised
 * `client_waitlist_spot` to MARKETING on the first pass — a category that is
 * billed higher AND withheld from anyone who opted out of marketing, which for
 * a time-boxed "a spot opened, claim it" offer means the message silently never
 * arrives. Refusing the change makes Meta reject the template outright instead,
 * which is a failure you can see and fix rather than one you discover months
 * later. Copy therefore has to read as purely transactional: no "Good news",
 * no offer framing, no adjectives Meta can read as promotional.
 */
async function requestApproval(sid, name) {
  const { ok, status, json } = await api(
    "POST",
    `/v1/Content/${sid}/ApprovalRequests/whatsapp`,
    { name, category: "UTILITY", allow_category_change: false }
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
    // v2 adds {{4}}, the venue. v1 (`client_session_reminder`, still the live
    // SID) named the class and the time and
    // nothing else — so the one message a parent acts on never said WHERE, and
    // for a private the class is titled "Private session", which left the
    // message saying almost nothing at all. The venue now comes from
    // location_label via the notify_name_the_session trigger (migration 0055).
    //
    // v1 stays the live SID until this is approved. The worker already sends
    // "4" and Twilio ignores variables a template doesn't declare, so nothing
    // breaks in between — swap TWILIO_WA_CLIENT_REMINDER_SID after approval.
    key: "TWILIO_WA_CLIENT_REMINDER_SID",
    approvalName: "client_session_reminder_v2",
    def: {
      friendly_name: "client_session_reminder_v2",
      language: "en",
      variables: {
        1: "Priya",
        2: "Beginners Batch",
        3: "6:30 pm",
        4: "Adarsh Palm Retreat Villas, Clubhouse",
      },
      types: {
        "twilio/quick-reply": {
          body:
            "Hi {{1}}! Reminder: {{2}} is on today at {{3}}, at {{4}}. Please let us know below whether you are coming, so the spot can go to another family if you cannot. See you at the table!",
          actions: [
            { title: "I'll be there", id: "rem_yes" },
            { title: "Can't make it", id: "rem_no" },
          ],
        },
        "twilio/text": {
          body:
            'Hi {{1}}! Reminder: {{2}} is on today at {{3}}, at {{4}}. Reply "yes" to confirm or "no" if you can\'t make it.',
        },
      },
    },
  },
  {
    // v2 of the waitlist offer. v1 (`client_waitlist_spot`,
    // HXa77dad95b34944dfbf2fd456502b06f5) was approved as MARKETING because
    // "Good news" + "First to claim it gets it" reads as promotional — so it is
    // withheld from marketing opt-outs, which is fatal for a 15-minute offer.
    // This copy states only the fact and the deadline: the recipient asked to be
    // on this waitlist, so telling them their turn came up is transactional.
    // v1 stays registered and stays the live SID until this is approved; then
    // swap TWILIO_WA_CLIENT_WAITLIST_SID over and delete v1.
    key: "TWILIO_WA_CLIENT_WAITLIST_SID",
    approvalName: "client_waitlist_spot_v2",
    def: {
      friendly_name: "client_waitlist_spot_v2",
      language: "en",
      variables: { 1: "Priya", 2: "Beginners Batch", 3: "15" },
      types: {
        "twilio/quick-reply": {
          body: "Hello {{1}}, a place has become available in {{2}}, which you are on the waiting list for. Your place is held for {{3}} minutes and is then released to the next person on the list. Please confirm below whether you would like it.",
          actions: [
            { title: "Claim spot", id: "wl_claim" },
            { title: "Pass", id: "wl_pass" },
          ],
        },
        "twilio/text": {
          body: 'Hello {{1}}, a place has become available in {{2}}, which you are on the waiting list for. Your place is held for {{3}} minutes and is then released to the next person. Reply "claim" to take it.',
        },
      },
    },
  },
  {
    // v2 fixes the localhost button. v1 (client_payment_issue,
    // HX211f1ec4d436eb80ac272f2f1395379a) was approved with
    // `http://localhost:3000/app/billing` as its "Fix payment" URL — the button
    // a parent taps when their card has failed, dead for every recipient.
    // v1 stays the live SID until this is approved; then swap and delete v1.
    key: "TWILIO_WA_CLIENT_PAYMENT_SID",
    approvalName: "client_payment_issue_v2",
    def: {
      friendly_name: "client_payment_issue_v2",
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
    // v2 fixes the localhost button (v1: HX2d1471f0b63a1841398c1a06aa691140).
    key: "TWILIO_WA_CLIENT_BOOKED_SID",
    approvalName: "client_booking_confirmed_v2",
    def: {
      friendly_name: "client_booking_confirmed_v2",
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
    // v2 fixes the localhost button (v1: HXfb3e148c113e74c6f73bd8ebddc29e8f).
    // Worst of the five in context: the body says "tap below for the address",
    // and the address was the one thing the coach could not reach.
    key: "TWILIO_WA_COACH_PRIVATE_SID",
    approvalName: "coach_private_session_v2",
    def: {
      friendly_name: "coach_private_session_v2",
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
    // v2 fixes the localhost button (v1: HX29ff9193137cb246eb12f5d302849974).
    key: "TWILIO_WA_FOUNDER_DIGEST_SID",
    approvalName: "founder_daily_digest_v2",
    def: {
      friendly_name: "founder_daily_digest_v2",
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
    // v3 is a rewrite, not a URL fix.
    //
    // v1 and v2 declare ONE content variable, so the entire digest — punctuality,
    // rosters, per-coach marking and the exceptions — had to be crammed into
    // {{2}}. What the founder actually received on 2026-08-01 was a single
    // run-on paragraph ending in a promise of "the full breakdown of bookings,
    // cancellations and new clients", which the digest stopped reporting when it
    // was rewritten to cover coach reliability. Both problems are in the
    // template, so neither could be fixed in the worker.
    //
    // Four labelled lines, one variable each. WhatsApp rejects newlines inside a
    // VARIABLE but not inside a BODY, which is exactly why the split has to
    // happen here: the worker sends four newline-free values and the template
    // supplies the line breaks. Static text sits between every pair so no two
    // variables are adjacent (Meta refuses that), and the body ends on text
    // rather than {{5}} for the same reason.
    key: "TWILIO_WA_FOUNDER_DIGEST_V3_SID",
    approvalName: "founder_daily_digest_v3",
    def: {
      friendly_name: "founder_daily_digest_v3",
      language: "en",
      variables: {
        1: "2026-08-01",
        2: "7 of 16 sessions started on time · Samir 12 min late (Beginners Batch)",
        3: "5 of 8 rosters marked · 2 left blank",
        4: "Augustine 0/3 · Samir 1/2 · Nandhan 3/4",
        5: "Augustine marked none of 3 · Windmills Private (9:00 am) had NO coach",
      },
      types: {
        "twilio/call-to-action": {
          body:
            "Sharwin Table Tennis Academy — your summary for {{1}}.\n" +
            "Punctuality: {{2}}.\n" +
            "Rosters: {{3}}.\n" +
            "Arrivals marked by coach: {{4}}.\n" +
            "Needs you: {{5}}.\n" +
            "Open the dashboard below for the full day.",
          actions: [{ type: "URL", title: "Open dashboard", url: `${APP_URL}/admin` }],
        },
        "twilio/text": {
          body:
            "Sharwin Table Tennis Academy — your summary for {{1}}.\n" +
            "Punctuality: {{2}}.\n" +
            "Rosters: {{3}}.\n" +
            "Arrivals marked by coach: {{4}}.\n" +
            "Needs you: {{5}}.\n" +
            `Full day on the dashboard: ${APP_URL}/admin`,
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
    // v2 fixes the localhost button (v1: HX97d0e9eafefe679f06d6545a1c98588b).
    key: "TWILIO_WA_CLIENT_APPROVED_SID",
    approvalName: "client_signup_approved_v2",
    def: {
      friendly_name: "client_signup_approved_v2",
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
    // v2 adds {{4}}, a directions link, as its own trailing sentence.
    //
    // Not folded into {{3}}: that variable lands mid-sentence, so a URL there
    // is followed by a full stop, which some clients swallow into the link. Not
    // a button either — this is a `twilio/quick-reply` template, and a URL
    // action can't sit alongside the Yes/No buttons.
    //
    // v1 (coach_coming_check) stays the live SID until v2 is approved. The
    // worker already sends "4", and a 3-variable template ignores the extra, so
    // nothing breaks in between — swap TWILIO_WA_COACH_COMING_SID after
    // approval.
    key: "TWILIO_WA_COACH_COMING_SID",
    approvalName: "coach_coming_check_v2",
    def: {
      friendly_name: "coach_coming_check_v2",
      language: "en",
      // {{3}} folds time + venue into one value ("6:30 pm at La Plazza").
      variables: {
        1: "Augustine",
        2: "Beginners Batch",
        3: "6:30 pm at Adarsh Palm Retreat Villas, Clubhouse",
        4: "https://maps.google.com/?q=12.921,77.688",
      },
      types: {
        // Meta rejects a body with too many variables for its length
        // (subCode 2388293) — the terse "Hi {{1}}! {{2}} starts at {{3}}. Are
        // you coming?" was refused. Keep enough literal text around the four
        // variables to clear that ratio.
        "twilio/quick-reply": {
          body:
            "Hi {{1}}, this is a quick check from Sharwin Table Tennis Academy about your upcoming session. Your class {{2}} is scheduled to start at {{3}}. Please let us know whether you are coming, so we can arrange cover in good time if you cannot. Directions to the venue are here: {{4}} — see you at the table.",
          actions: [
            { title: "Yes, I'm coming", id: "coach_confirm" },
            { title: "Can't make it", id: "coach_cant" },
          ],
        },
        "twilio/text": {
          body:
            'Hi {{1}}, a quick check about your upcoming session. Your class {{2}} is scheduled to start at {{3}}. Reply "coming" if you are on your way, or "can\'t make it" so we can arrange cover. Directions: {{4}} — thank you.',
        },
      },
    },
  },
  {
    // Coach: "Have you reached?" at start time — asked only if arrival is still
    // missing. I've arrived / Running late.
    // v2 adds the same trailing {{4}} directions link as coach_coming_check_v2,
    // and matters most here: this fires at start time, so a coach standing at
    // the wrong gate of a gated complex has minutes, not hours, to fix it.
    // Same rollout — v1 stays live until v2 is approved.
    key: "TWILIO_WA_COACH_ARRIVAL_SID",
    approvalName: "coach_arrival_check_v2",
    def: {
      friendly_name: "coach_arrival_check_v2",
      language: "en",
      variables: {
        1: "Augustine",
        2: "Beginners Batch",
        3: "Adarsh Palm Retreat Villas, Clubhouse",
        4: "https://maps.google.com/?q=12.921,77.688",
      },
      types: {
        // Lengthened for the same Meta variables-to-length rule as
        // coach_coming_check_v2 above.
        "twilio/quick-reply": {
          body:
            "Hi {{1}}, your session at Sharwin Table Tennis Academy is about to begin. The class {{2}} is starting now, and we would like to confirm that you have reached {{3}}. Please let us know so we can keep the parents updated. If you need directions, they are here: {{4}} — thank you.",
          actions: [
            { title: "I've arrived", id: "coach_arrived" },
            { title: "Running late", id: "coach_late" },
          ],
        },
        "twilio/text": {
          body:
            'Hi {{1}}, your session is about to begin. The class {{2}} is starting now — have you reached {{3}}? Reply "arrived" or "running late" so we can keep the parents updated. Directions: {{4}} — thank you.',
        },
      },
    },
  },
  {
    // Coach: the T-30 chase, sent ONLY when the coach has stayed silent since
    // T-60. Until now this rung had no template at all, so it arrived as plain
    // text with no buttons — and outside the 24h window as the buttonless
    // generic template, which records no twilio_sid and so cannot be replied to.
    // The one message aimed at a coach who has gone quiet was the one that
    // degraded most.
    //
    // Deliberately NOT a reuse of coach_coming_check_v2. Same question, same two
    // button ids, but this has to read as a follow-up: the founder complaint was
    // "why are there two?", and the answer was that both said "quick check".
    key: "TWILIO_WA_COACH_NUDGE_SID",
    approvalName: "coach_confirm_nudge",
    def: {
      friendly_name: "coach_confirm_nudge",
      language: "en",
      variables: {
        1: "Augustine",
        2: "Beginners Batch",
        3: "6:30 pm, Adarsh Palm Retreat Villas, Clubhouse",
        4: "https://maps.google.com/?q=12.921,77.688",
      },
      types: {
        // Kept wordy for Meta's variables-to-length rule (subCode 2388293), the
        // same one that refused the terse coach_coming_check body.
        "twilio/quick-reply": {
          body:
            "Hi {{1}}, we still have not heard from you about your session at Sharwin Table Tennis Academy. Your class {{2}} starts at {{3}}, and the founder is alerted in twenty minutes if we do not know whether you are coming. Please let us know either way so cover can be arranged in time. Directions are here: {{4}} — thank you.",
          actions: [
            { title: "Yes, I'm coming", id: "coach_confirm" },
            { title: "Can't make it", id: "coach_cant" },
          ],
        },
        "twilio/text": {
          body:
            'Hi {{1}}, we still have not heard from you about {{2}}, starting at {{3}}. Reply "coming" or "can\'t make it" — the founder is alerted in twenty minutes otherwise. Directions: {{4}}',
        },
      },
    },
  },
  {
    // Coach: a session has lost its coach and needs cover. One button.
    //
    // The `cover_claim` button id has existed in lib/whatsapp/interactive.ts
    // since cover offers shipped, but no template ever declared it — so the only
    // way to claim was to type "claim". This is the template that finally makes
    // the id reachable. First tap still wins; claim_cover_session settles the
    // race with SELECT ... FOR UPDATE, and a loser gets "already taken".
    key: "TWILIO_WA_COACH_COVER_SID",
    approvalName: "coach_cover_offer",
    def: {
      friendly_name: "coach_cover_offer",
      language: "en",
      variables: {
        1: "Augustine",
        2: "Beginners Batch",
        3: "Sat 12 Jul, 6:30 pm, Adarsh Palm Retreat Villas, Clubhouse",
        4: "https://maps.google.com/?q=12.921,77.688",
      },
      types: {
        "twilio/quick-reply": {
          body:
            "Hi {{1}}, a session at Sharwin Table Tennis Academy has lost its coach and we are looking for cover. The class is {{2}}, on {{3}}. The first coach to claim it takes it, so please only accept if you are sure you can be there. Directions to the venue are here: {{4}} — thank you for helping out.",
          actions: [{ title: "Claim this session", id: "cover_claim" }],
        },
        "twilio/text": {
          body:
            'Hi {{1}}, a session needs cover: {{2}}, on {{3}}. The first coach to claim it takes it — reply "claim" if you can be there. Directions: {{4}}',
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
