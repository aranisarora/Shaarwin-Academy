// P11 — delivery worker. Deploy as a Supabase Edge Function on a 1-minute cron:
//   supabase functions deploy notify
//   select cron.schedule('notify-worker', '* * * * *', $$select net.http_post(
//     url := 'https://<ref>.supabase.co/functions/v1/notify',
//     headers := '{"Authorization": "Bearer <service-role-key>"}'::jsonb)$$);
//
// Claims due rows (skip-locked semantics via status flip), delivers them over
// web push / WhatsApp / Resend email, marks sent/failed. After delivery it runs
// a set of sweeps (waitlist offers, coach prompts, founder escalations,
// after-class summaries).
//
// The comment that used to sit here claimed the worker tried "web push, falling
// back to email". It never did — there were no VAPID keys and no sender, so
// push was a table with zero rows and a service worker listening for a message
// nobody sent. deliverPush() below is that missing leg. Read it together with
// the note above PUSH_ADDITIVE: push is deliberately NOT a cheaper substitute
// for WhatsApp on anything time-critical.

import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
// Must be an address on a domain verified in Resend. It used to be
// notify@resend.dev — Resend's shared test domain, which hard-403s any
// recipient other than the account owner ("You can only send testing emails to
// your own email address"). That silently broke the email fallback for every
// user except one, which is most of what `status='failed'` was.
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Sharwin TTA <notify@sharwinacademy.com>";
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM"); // "whatsapp:+1..."
// Approved Twilio Content template SID for out-of-24h-window sends. One generic
// Utility template with two variables: {{1}} = first name, {{2}} = the message.
// Free-form is used instead whenever the user messaged within the last 24h.
const TWILIO_TEMPLATE_SID = Deno.env.get("TWILIO_WA_TEMPLATE_SID");
// Interactive Content template SIDs (WhatsApp-approved quick-reply buttons).
// Optional: until these are provisioned the coach prompts degrade gracefully to
// plain text. See scripts/whatsapp/provision-templates.mjs and
// docs/whatsapp-interactive.md.
// coach_before_class now uses TWILIO_WA_COACH_COMING_SID (arrival-flow-plan) —
// the old three-button coach_class_reminder template stays registered in Twilio
// but is no longer referenced (it re-introduced the "arrived" button at T-60).
const TWILIO_WA_COACH_AFTERCLASS_SID = Deno.env.get("TWILIO_WA_COACH_AFTERCLASS_SID");
// Client + coach + founder templates added in whatsapp-upgrade-plan Part 3. All
// optional: until each SID is set the matching notification degrades to plain
// text (and, for the client button flows, typed replies still reach the agent).
const TWILIO_WA_CLIENT_REMINDER_SID = Deno.env.get("TWILIO_WA_CLIENT_REMINDER_SID");
const TWILIO_WA_CLIENT_WAITLIST_SID = Deno.env.get("TWILIO_WA_CLIENT_WAITLIST_SID");
const TWILIO_WA_CLIENT_PAYMENT_SID = Deno.env.get("TWILIO_WA_CLIENT_PAYMENT_SID");
const TWILIO_WA_CLIENT_BOOKED_SID = Deno.env.get("TWILIO_WA_CLIENT_BOOKED_SID");
const TWILIO_WA_COACH_PRIVATE_SID = Deno.env.get("TWILIO_WA_COACH_PRIVATE_SID");
const TWILIO_WA_FOUNDER_DIGEST_SID = Deno.env.get("TWILIO_WA_FOUNDER_DIGEST_SID");
// Signup-approval flow (new-user-approval-plan). Founder Approve/Deny buttons +
// the client "you're approved" CTA. Optional until provisioned.
const TWILIO_WA_FOUNDER_SIGNUP_SID = Deno.env.get("TWILIO_WA_FOUNDER_SIGNUP_SID");
const TWILIO_WA_CLIENT_APPROVED_SID = Deno.env.get("TWILIO_WA_CLIENT_APPROVED_SID");
// Arrival-flow templates (arrival-flow-plan Part 4). "Coming?" at T-60 and
// "Reached?" at start ask the coach one thing at a time; the two client
// templates tell parents the coach arrived / is running late. All optional:
// until each SID is set the matching notification degrades to plain text.
const TWILIO_WA_COACH_COMING_SID = Deno.env.get("TWILIO_WA_COACH_COMING_SID");
const TWILIO_WA_COACH_ARRIVAL_SID = Deno.env.get("TWILIO_WA_COACH_ARRIVAL_SID");
// The T-30 chase and the cover offer. Both were plain text until now, which
// meant no buttons at all — and outside the 24h window they degraded to the
// generic template, which records no twilio_sid, so a reply couldn't even be
// mapped back to a session. That hit hardest on exactly the two messages meant
// to reach someone who has gone quiet.
const TWILIO_WA_COACH_NUDGE_SID = Deno.env.get("TWILIO_WA_COACH_NUDGE_SID");
const TWILIO_WA_COACH_COVER_SID = Deno.env.get("TWILIO_WA_COACH_COVER_SID");
const TWILIO_WA_CLIENT_ARRIVED_SID = Deno.env.get("TWILIO_WA_CLIENT_ARRIVED_SID");
const TWILIO_WA_CLIENT_LATE_SID = Deno.env.get("TWILIO_WA_CLIENT_LATE_SID");
// ── Web push (RFC 8291 / RFC 8292) ──────────────────────────────────────────
// The public key must be the same string the browser subscribes with
// (NEXT_PUBLIC_VAPID_PUBLIC_KEY in the app build) — a subscription is bound to
// the key that created it, so a mismatch here doesn't warn, it just 403s every
// send. Both are base64url: the public key is the 65-byte uncompressed P-256
// point, the private key the 32-byte scalar. Unset = push is skipped and the
// other channels carry everything, exactly as before this existed.
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@sharwinacademy.com";
const APP_URL = Deno.env.get("APP_URL") ?? "https://sharwinacademy.com";
const WINDOW_MS = 24 * 60 * 60 * 1000;
const IST = "Asia/Kolkata";

// Types that ignore user prefs (always deliver). The signup-approval messages
// are account-critical: the applicant is waiting on the pending screen, and the
// founder needs to act — neither should be silenced by a pref toggle.
const TRANSACTIONAL = new Set([
  "payment_failed",
  "session_cancelled",
  "signup_request",
  "signup_approved",
  // A parent believing their child is at the table when they aren't is a
  // safety matter, not a preference. (C11 / M1.)
  "player_absent",
]);

// Founder ops-feed types that live in-app only (/admin). We never deliver these
// over WhatsApp/email — the row is claimed (flipped to sent) and left for the
// dashboard to render. The founder's WhatsApp is escalations + the daily digest
// only. (whatsapp-upgrade-plan Part 1.)
const FEED_ONLY = new Set([
  "ops_booking",
  "ops_cancellation",
  "ops_attendance",
  "ops_payment",
  "ops_membership",
  "ops_new_client",
  "ops_new_coach",
  "ops_player_added",
  "ops_wa_linked",
  "ops_credit_used",
  "ops_coach_change",
  // Cover was picked up by a coach — an outcome, not a task.
  "ops_cover_claimed",
  // Data-integrity alert: a session whose assigned coach isn't a coach. Feed +
  // digest rather than an interrupt — it needs fixing, not acting on mid-class.
  "ops_session_coach_invalid",
]);

// Quiet hours: these non-time-critical types, when they come due inside IST
// [21:30, 08:00), are pushed to the next 08:00 IST instead of pinging someone
// overnight. Time-bound types (reminders, waitlist, arrivals, escalations) are
// deliberately absent so they still fire. Kept separate from TRANSACTIONAL:
// payment_failed bypasses *prefs* but is still deferred (nobody fixes a card at
// 2am). (whatsapp-upgrade-plan Part 7.)
const DEFERRABLE = new Set([
  "booking_confirmed",
  "booking_rescheduled",
  "coach_assigned",
  "coach_changed",
  "role_changed",
  "private_series_ended",
  "private_minutes_low",
  "payment_failed",
  "ops_daily_digest",
  "time_off_requested",
  "time_off_decision",
  // Client copy of an academy-booked private (G1). Informational, not urgent —
  // the session itself gets its own reminder 3h before.
  "private_session_booked",
  // "You're approved" — nobody onboards at 2am, so hold it to 08:00 IST. The
  // signup *request* is deliberately absent: the applicant is waiting live.
  "signup_approved",
  // The six types that were wired into the prefs UI with no sender (0048 +
  // the two sweeps below). Every one is informational — a receipt, a progress
  // note, a class that opened — so none of them earns waking anyone up.
  "payment_receipt",
  "renewal_upcoming",
  "new_class_open",
  "assessment_ready",
  "student_note",
  "monthly_progress",
  // NOTE: coach_day_ahead and founder_morning_brief are deliberately absent.
  // They fire at 07:00 IST, which is inside quiet hours [21:30, 08:00) — adding
  // them here would push a 07:00 briefing to 08:00 and silently destroy the
  // hour of lead time that is the entire reason the message exists.
]);

// ── Per-user daily cap (notification-fix-plan 2.2) ──────────────────────────
//
// The structural guarantee behind "don't spam anyone", designed to survive
// every message type added later: nobody receives more than DAILY_SEND_CAP
// non-essential messages in one IST day. Overflow is held to the next morning
// rather than dropped, so nothing is silently lost.
//
// CAP_EXEMPT is the important half. The plan states the rule as "max 3
// non-transactional sends per user per day", but applied literally that muzzles
// the flow production shows working best: a coach teaching four classes needs
// four before-class prompts and four after-class summaries, and a parent needs
// to hear their coach is running late whether or not it's their fourth message.
// Suppressing any of these causes a real-world failure, not just a quieter
// phone — so time-critical and session-operational types are exempt, and the
// cap bites on the informational tail (schedule changes, receipts, progress
// updates, offers) where a fourth message in a day is genuinely noise.
const DAILY_SEND_CAP = 3;

const CAP_EXEMPT = new Set([
  // Coach: running their own class.
  "coach_before_class",
  "coach_confirm_nudge_2",
  "coach_arrival_check",
  "coach_after_class",
  "new_private_session",
  "session_unassigned",
  // A class with no coach is an emergency for whoever can fix it.
  "cover_offer",
  // Parent: did my child turn up, where is their coach, is the session still on.
  // Both outcome types are at most one per player per session, so a family with
  // three children legitimately gets three — the Progress toggle is the right
  // lever for that, not the daily cap.
  "player_absent",
  "session_outcome",
  "coach_arrived",
  "coach_late",
  "reminder_upcoming",
  "waitlist_spot",
  // Founder: act-now escalations and the once-a-day digest.
  "ops_coach_unconfirmed",
  "ops_coach_not_arrived",
  "ops_daily_digest",
  // The morning briefings. Both are once per day and both are the message the
  // whole day is planned from — a coach who doesn't get theirs drives to the
  // wrong venue. Capping them would be capping the plan, not the noise.
  "coach_day_ahead",
  "founder_morning_brief",
]);

// Capped rows this old are past being worth holding — a "your coach changed"
// for a session that already happened helps nobody. Dropped (claimed, never
// delivered) rather than deferred forever.
const CAP_DROP_AFTER_MS = 3 * 86400000;

// ── Push is ADDITIVE for these, not a substitute ────────────────────────────
//
// deliver() is first-success-wins by design, and that is right for the
// informational tail: if a receipt lands on someone's lock screen there is no
// reason to also spend a WhatsApp on it. Applied to the whole list, though, it
// quietly does the opposite of what push is for. Anyone who subscribes STOPS
// getting WhatsApp — including a coach whose phone is face-down on a bench, on
// Do Not Disturb, in a hall with no wifi, forty minutes before the class they
// haven't confirmed. A push banner nobody sees would then count as delivered,
// and the escalation ladder that exists precisely because the coach is a single
// point of failure (docs/whatsapp-messaging.md is explicit about there being no
// redundancy behind them) would fire against a message we told ourselves went
// out.
//
// So for the time-critical set, push goes out AND WhatsApp follows. Two
// channels for the handful of messages where a miss costs a real session, one
// channel for everything else. The row records `push+whatsapp` so it still
// explains itself afterwards.
//
// The set is CAP_EXEMPT (already curated as "a miss here causes a real-world
// failure, not just a quieter phone") plus TRANSACTIONAL (account-critical
// enough to ignore preferences — a failed payment, a cancelled session, someone
// waiting on an approval). Deriving it rather than writing a third list is
// deliberate: two definitions of "urgent" would drift apart within a month.
const PUSH_ADDITIVE = new Set([...CAP_EXEMPT, ...TRANSACTIONAL]);

// ── A subscription can be valid and still be nobody ─────────────────────────
//
// The additive rule above protects the urgent set. It does nothing for the
// informational tail, and that is where the quieter version of the same failure
// lives: a push counted as delivered the moment the push SERVICE accepted it,
// which says nothing at all about whether a human will see it. Self-cleaning
// only fires on 404/410 — a subscription that is stale but still VALID, a
// desktop Chrome profile signed into once and never opened again, a second
// browser on a work laptop, returns 201 indefinitely. One of those permanently
// absorbed that person's whole tail: booking_confirmed, booking_rescheduled,
// coach_assigned, coach_changed, payment_receipt, renewal_upcoming,
// assessment_ready, student_note, monthly_progress, private_session_booked.
// All of those reach people on WhatsApp today; they would have stopped
// silently, with the row recording channel_attempted='push' so no failure query
// would ever have shown it.
//
// push_subscriptions.last_seen_at (migration 0060) is the missing fact.
// PushToggle re-upserts on every mount and a trigger stamps the column, so a
// device anyone actually opens keeps itself fresh. An endpoint seen inside
// PUSH_FRESH_MS may end the chain; an older one still GETS the push — it may
// well be the right device, we just don't know — but WhatsApp follows it.
// Anything untouched for PUSH_STALE_MS is deleted, because at that point it is
// only a row that makes our numbers look better than they are.
const PUSH_FRESH_MS = 30 * 86400000;
const PUSH_STALE_MS = 90 * 86400000;

// ── Grouped preferences (notification-fix-plan 2.6 / G9) ────────────────────
//
// Members now toggle three groups — Reminders · Progress · News & offers —
// instead of five per-type switches that covered a fraction of what we send.
//
// MUST stay in sync with PREF_GROUP_FOR_TYPE in lib/notification-prefs.ts. The
// worker is Deno and can't import from lib/, so the map is duplicated here on
// purpose (same arrangement as the WhatsApp button ids). A type in neither map
// is unmutable, so an omission fails loud rather than silent.
const PREF_GROUP_FOR_TYPE: Record<string, string> = {
  reminder_upcoming: "reminders",
  waitlist_spot: "reminders",
  coach_changed: "reminders",
  booking_rescheduled: "reminders",
  booking_confirmed: "reminders",
  session_moved: "reminders",
  class_updated: "reminders",
  coach_assigned: "reminders",
  private_session_booked: "reminders",
  // Mutable on purpose: reassurance decays with repetition. coach_late is NOT
  // here — a coach *not* being there is what a parent needs to know.
  coach_arrived: "reminders",

  session_outcome: "progress",
  monthly_progress: "progress",
  assessment_ready: "progress",
  student_note: "progress",

  announcement: "news",
  renewal_upcoming: "news",
  new_class_open: "news",
  payment_receipt: "news",
};

/** Per-type keys win over the group toggle, so pre-regrouping choices survive. */
function mutedByPrefs(type: string, prefs: Record<string, boolean> | null): boolean {
  if (!prefs) return false;
  if (prefs[type] === false) return true;
  const group = PREF_GROUP_FOR_TYPE[type];
  return group ? prefs[group] === false : false;
}

Deno.serve(async () => {
  const { data: due } = await supabase
    .from("notifications")
    .select("id,user_id,type,title,body,data,created_at")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(100);

  let sent = 0;
  let failed = 0;
  // Anti-noise: one delivery per (user, type, booking-or-session) per batch —
  // later rows win. booking_id first so per-player rows (attendance, ops feed)
  // for the same session don't collapse into one.
  const seen = new Set<string>();
  const rows = [...(due ?? [])].reverse();

  for (const row of rows) {
    const dedupeKey = `${row.user_id}:${row.type}:${row.data?.booking_id ?? row.data?.session_id ?? row.id}`;
    if (seen.has(dedupeKey)) {
      await markSent(row.id);
      continue;
    }
    seen.add(dedupeKey);

    // Feed-only ops rows never leave the DB: claim and move on so the founder's
    // WhatsApp stays quiet while /admin still renders them. (Part 1.)
    if (FEED_ONLY.has(row.type)) {
      await markSent(row.id);
      continue;
    }

    // Quiet hours: defer non-urgent types that come due overnight. (Part 7.)
    if (DEFERRABLE.has(row.type)) {
      const deferTo = quietHoursDefer();
      if (deferTo) {
        await supabase
          .from("notifications")
          .update({ scheduled_for: deferTo })
          .eq("id", row.id)
          .eq("status", "pending");
        continue;
      }
    }

    // Prefs: non-transactional types respect profiles.notification_prefs, and
    // a member who sent STOP is muted for everything non-transactional
    // regardless of type — including types added after they opted out. (2.3.)
    if (!TRANSACTIONAL.has(row.type)) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("notification_prefs,wa_muted")
        .eq("id", row.user_id)
        .maybeSingle();
      if (profile?.wa_muted) {
        await markSent(row.id);
        continue;
      }
      if (mutedByPrefs(row.type, profile?.notification_prefs ?? null)) {
        await markSent(row.id);
        continue;
      }
    }

    // Per-user daily cap (2.2). Checked after prefs so a muted type never
    // consumes someone's allowance, and before the claim so a deferred row
    // stays pending.
    if (!TRANSACTIONAL.has(row.type) && !CAP_EXEMPT.has(row.type)) {
      const alreadySent = await deliveredTodayCount(row.user_id);
      if (alreadySent >= DAILY_SEND_CAP) {
        if (Date.now() - new Date(row.created_at).getTime() > CAP_DROP_AFTER_MS) {
          await markSent(row.id); // stale — claim it and move on
        } else {
          await supabase
            .from("notifications")
            .update({ scheduled_for: nextMorningIst() })
            .eq("id", row.id)
            .eq("status", "pending");
        }
        continue;
      }
    }

    // Claim: only proceed if we flip pending → sent first (idempotent workers).
    const { data: claimed } = await supabase
      .from("notifications")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const attempt = await deliver(row);
    if (attempt.ok) {
      sent++;
      // `error` on a sent row is not a failure — it is why the channel we would
      // have preferred didn't carry it. Written only when there is something to
      // say, so `error is not null and status = 'sent'` reads as "delivered the
      // hard way" and stays queryable long after the edge logs have rolled over.
      await supabase
        .from("notifications")
        .update({
          channel_attempted: attempt.channel,
          ...(attempt.note ? { error: attempt.note.slice(0, 500) } : {}),
        })
        .eq("id", row.id);
    } else {
      failed++;
      await supabase
        .from("notifications")
        .update({
          status: "failed",
          channel_attempted: attempt.channel,
          error: (attempt.error ?? "unknown").slice(0, 500),
        })
        .eq("id", row.id);
    }
  }

  // Post-delivery sweeps. Each is isolated so one failure can't break the
  // others or the delivery loop above.
  await safeSweep("waitlist-offers", sweepWaitlistOffers);
  await safeSweep("cover-offers", sweepCoverOffers);
  await safeSweep("before-class", sweepBeforeClass);
  await safeSweep("coach-confirm-nudge", sweepCoachConfirmNudge);
  await safeSweep("arrival-check", sweepArrivalCheck);
  await safeSweep("founder-escalations", sweepFounderEscalations);
  await safeSweep("after-class", sweepAfterClass);
  await safeSweep("founder-digest", sweepFounderDigest);
  await safeSweep("coach-day-ahead", sweepCoachDayAhead);
  await safeSweep("founder-morning-brief", sweepFounderMorningBrief);
  await safeSweep("renewal-reminders", sweepRenewalReminders);
  await safeSweep("monthly-progress", sweepMonthlyProgress);
  await safeSweep("stale-push", sweepStalePushSubscriptions);

  return new Response(JSON.stringify({ sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function safeSweep(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`notify: sweep ${name} failed`, err);
  }
}

/** Claim a row without delivering — flip pending → sent, idempotently. */
async function markSent(id: string) {
  await supabase
    .from("notifications")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
}

/**
 * If "now" falls inside IST quiet hours [21:30, 08:00), returns the ISO instant
 * of the next 08:00 IST; otherwise null. Used to hold deferrable notifications
 * overnight. India has no DST, so a fixed +05:30 offset is safe. (Part 7.)
 */
function quietHoursDefer(): string | null {
  const now = new Date();
  const [hh, mm] = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST,
  })
    .format(now)
    .split(":")
    .map(Number);
  const mins = hh * 60 + mm;
  const inQuiet = mins >= 21 * 60 + 30 || mins < 8 * 60;
  if (!inQuiet) return null;

  const istDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: IST,
  }).format(now); // today's IST calendar date
  const eightAm = new Date(`${istDate}T08:00:00+05:30`);
  // Before 08:00 IST → today's 08:00; after 21:30 IST → tomorrow's 08:00.
  return (mins >= 8 * 60 ? new Date(eightAm.getTime() + 86400000) : eightAm).toISOString();
}

/** Start of the current IST calendar day, as an ISO instant. */
function istDayStart(): string {
  const istDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: IST,
  }).format(new Date());
  return new Date(`${istDate}T00:00:00+05:30`).toISOString();
}

/** The next 08:00 IST strictly in the future. Used to hold capped overflow. */
function nextMorningIst(): string {
  const now = new Date();
  const istDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: IST,
  }).format(now);
  const eight = new Date(`${istDate}T08:00:00+05:30`);
  return (eight.getTime() > now.getTime()
    ? eight
    : new Date(eight.getTime() + 86400000)
  ).toISOString();
}

/**
 * How many messages we have actually pushed to this user so far today. Counts
 * only rows that reached a channel — `channel_attempted` is null for feed-only
 * rows (claimed, never delivered) and for pref-muted rows, so neither eats into
 * anyone's daily allowance. (notification-fix-plan 2.2.)
 *
 * Push-only rows are excluded, and the reasoning matters. The cap exists to
 * stop us interrupting a family three times a day on their phone's messaging
 * app; it was written when every delivery cost a WhatsApp. A push banner is a
 * different, quieter thing — free, dismissible, and already opt-in per device.
 * Counting it would mean that turning notifications ON silently REDUCED how
 * many WhatsApps you could receive, so the feature would punish the people who
 * adopted it. `push+whatsapp` still counts: a WhatsApp genuinely went out.
 */
async function deliveredTodayCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "sent")
    .not("channel_attempted", "is", null)
    .neq("channel_attempted", "push")
    .gte("sent_at", istDayStart());
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Coach prompts + founder escalations
//
// Philosophy: coaches drive their own class through interactive prompts; the
// founder is only pinged when an action is actually expected of them (a coach
// who hasn't confirmed as the class nears, is running late, or hasn't shown up)
// — never for happy-path status updates.
// ---------------------------------------------------------------------------

/**
 * Drop swept sessions whose assigned coach isn't actually a coach, and raise a
 * feed alert for each. (notification-fix-plan 2.4.)
 *
 * Production case: a client (role=client) received `coach_before_class` and
 * `coach_after_class` for "Apr Villa Private", because that session's `coach_id`
 * pointed at a non-coach profile. Every sweep below trusts `coach_id` to mean
 * "a coach", so one bad row turns the whole coach message loop on a parent —
 * who then gets asked to confirm attendance for a class they're attending.
 *
 * One extra query per sweep, not one per session: the ids are looked up in a
 * single batch.
 */
async function withValidCoaches<T extends { id: string; coach_id: string }>(
  rows: T[]
): Promise<T[]> {
  if (!rows.length) return rows;

  const ids = [...new Set(rows.map((r) => r.coach_id))];
  const { data } = await supabase.from("profiles").select("id,role").in("id", ids);
  const valid = new Set((data ?? []).filter((p) => p.role === "coach").map((p) => p.id));

  for (const r of rows) {
    if (!valid.has(r.coach_id)) await alertInvalidCoach(r.coach_id, r.id);
  }
  return rows.filter((r) => valid.has(r.coach_id));
}

/** Tell the founders once per session that its coach assignment is broken. */
async function alertInvalidCoach(coachId: string, sessionId: string) {
  const { data: done } = await supabase
    .from("notifications")
    .select("id")
    .eq("type", "ops_session_coach_invalid")
    .eq("data->>session_id", sessionId)
    .limit(1);
  if (done?.length) return;

  const { data: founders } = await supabase.from("profiles").select("id").eq("role", "founder");
  if (!founders?.length) return;

  await supabase.from("notifications").insert(
    founders.map((f) => ({
      user_id: f.id,
      type: "ops_session_coach_invalid",
      title: "Session has a non-coach assigned",
      body:
        "A scheduled session lists someone who isn't a coach as its coach. " +
        "Coach prompts for it are suppressed until it's reassigned.",
      data: { session_id: sessionId, coach_id: coachId, url: "/admin/schedule" },
    }))
  );
}

/**
 * Class title + location strings for a swept session. `location_label` and
 * `location_maps_url` are PostgREST computed fields backed by
 * public.location_label(classes) / public.location_maps_url(classes) — the same
 * ones offer_cover and coach_mark_arrival read, so every surface names the
 * place identically. The old venues(name) ?? private_class_details(address)
 * fallback lived here and drifted from the SQL callers; keeping one definition
 * in the database is what stops it drifting again.
 */
const CLASS_LOCATION_SELECT = "title,location_label,location_maps_url";

function locationOf(classes: unknown): {
  title: string;
  location: string;
  mapsUrl: string | null;
} {
  const cls = classes as {
    title?: string;
    location_label?: string | null;
    location_maps_url?: string | null;
  } | null;
  return {
    title: cls?.title ?? "your class",
    location: cls?.location_label ?? "",
    mapsUrl: cls?.location_maps_url ?? null,
  };
}

/**
 * Directions as their own trailing line. The name is what a coach reads; the
 * link is the safety net for when it isn't enough — a wrong-gate arrival at a
 * gated complex costs the whole session.
 *
 * Deliberately NOT folded into the location value. The two templates that carry
 * a location (coach_coming_check, coach_arrival_check) interpolate it
 * mid-sentence, so a URL there would be followed by a full stop — which some
 * clients swallow into the link — and reads badly besides. It also can't be a
 * template BUTTON: both are `twilio/quick-reply` templates, and a URL action
 * can't sit alongside their Yes/No buttons.
 *
 * So it goes in as its own trailing variable ({{4}}, see
 * scripts/whatsapp/provision-templates.mjs) and, for the plain-text and in-app
 * paths, its own line. Templates still on the 3-variable version simply ignore
 * the extra value, so this degrades to today's behaviour until the v2
 * templates are approved and their SIDs swapped in.
 */
function mapsLine(mapsUrl: string | null): string {
  return mapsUrl ? `
Directions: ${mapsUrl}` : "";
}

/**
 * 1 hour before each session, ask the assigned coach ONE thing — "Are you
 * coming?" — with Yes / Can't make it buttons (falls back to text until the
 * WhatsApp template is provisioned; the inbound webhook also accepts the words
 * typed out). Arrival is a separate question asked at start time. Fires once per
 * (coach, session) and targets the whole next-60-min window, so a skipped cron
 * tick still delivers.
 */
async function sweepBeforeClass() {
  const now = Date.now();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      `id,starts_at,coach_id,classes!inner(${CLASS_LOCATION_SELECT})`
    )
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + 60 * 60000).toISOString())
    .limit(100);

  for (const s of await withValidCoaches(sessions ?? [])) {
    if (await alreadyFired("coach_before_class", s.id, s.coach_id)) continue;

    const { title, location, mapsUrl } = locationOf(s.classes);
    const loc = location ? ` at ${location}` : "";
    const time = fmtClock(s.starts_at);
    const firstName = await firstNameOf(s.coach_id);

    await supabase.from("notifications").insert({
      user_id: s.coach_id,
      type: "coach_before_class",
      title: "Class reminder",
      body: `Hi ${firstName}! ${title} starts at ${time}${loc}. Are you coming? Reply "coming" or "can't make it".${mapsLine(mapsUrl)}`,
      data: {
        session_id: s.id,
        kind: "before_class",
        first_name: firstName,
        class_title: title,
        time_str: time,
        location_str: loc,
        maps_url: mapsUrl,
        url: `/coach/session/${s.id}`,
      },
    });
  }
}

/**
 * T-30 → T-0: if a coach still hasn't confirmed OR arrived, nudge the *coach*
 * once more (not the founder) with an honest heads-up that the founder gets
 * alerted at T-10 if we still haven't heard. Plain text is fine — no dedicated
 * template. Fires once per (coach, session).
 */
async function sweepCoachConfirmNudge() {
  const now = Date.now();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(`id,starts_at,coach_id,classes!inner(${CLASS_LOCATION_SELECT})`)
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .is("coach_confirmed_at", null)
    .is("coach_arrived_at", null)
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + 30 * 60000).toISOString())
    .limit(100);

  for (const s of await withValidCoaches(sessions ?? [])) {
    if (await alreadyFired("coach_confirm_nudge_2", s.id, s.coach_id)) continue;

    // Carries the venue and directions like the other two rungs. It used to
    // select only the title, which is why this rung could never fill a
    // location-bearing template even once it had one.
    const { title, location, mapsUrl } = locationOf(s.classes);
    const where = location || "the venue";
    const time = fmtClock(s.starts_at);
    const firstName = await firstNameOf(s.coach_id);

    await supabase.from("notifications").insert({
      user_id: s.coach_id,
      type: "coach_confirm_nudge_2",
      title: "Still need to hear from you",
      body: `We haven't heard about ${title} at ${time}, ${where}. Are you coming? The founder is alerted in 20 minutes if we still don't know.${mapsLine(mapsUrl)}`,
      data: {
        session_id: s.id,
        first_name: firstName,
        class_title: title,
        time_str: time,
        location_str: where,
        maps_url: mapsUrl,
        url: `/coach/session/${s.id}`,
      },
    });
  }
}

/**
 * At start time (window [now-10min, now]) — if the coach hasn't marked arrival,
 * ask ONE thing: "Have you reached?" with I've arrived / Running late buttons.
 * Sent only once per (coach, session); arrival being marked by any surface
 * short-circuits it via the coach_arrived_at filter. Plain text fallback until
 * the template is provisioned.
 */
async function sweepArrivalCheck() {
  const now = Date.now();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      `id,starts_at,coach_id,classes!inner(${CLASS_LOCATION_SELECT})`
    )
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .is("coach_arrived_at", null)
    .lte("starts_at", new Date(now).toISOString())
    .gt("starts_at", new Date(now - 10 * 60000).toISOString())
    .limit(100);

  for (const s of await withValidCoaches(sessions ?? [])) {
    if (await alreadyFired("coach_arrival_check", s.id, s.coach_id)) continue;

    const { title, location, mapsUrl } = locationOf(s.classes);
    const where = location || "the venue";
    const time = fmtClock(s.starts_at);
    const firstName = await firstNameOf(s.coach_id);

    await supabase.from("notifications").insert({
      user_id: s.coach_id,
      type: "coach_arrival_check",
      title: "Have you reached?",
      body: `${title} is starting. Have you reached ${where}? Reply "arrived" or "running late".${mapsLine(mapsUrl)}`,
      data: {
        session_id: s.id,
        first_name: firstName,
        class_title: title,
        time_str: time,
        location_str: where,
        maps_url: mapsUrl,
        url: `/coach/session/${s.id}`,
      },
    });
  }
}

/**
 * Founder escalations — silent coaches only, and only when the founder may need
 * to act:
 *  (a) T-10 and the coach is still fully silent (no confirm AND no arrival);
 *  (b) start+10 and the coach hasn't marked arrival — copy distinguishes
 *      "confirmed then went silent" (more urgent) from "never answered at all".
 * The T-30 nudge (sweepCoachConfirmNudge) targets the coach, not the founder;
 * running late is pushed by coach_mark_arrival itself. Fires once per session.
 */
async function sweepFounderEscalations() {
  const now = Date.now();

  const { data: unconfirmed } = await supabase
    .from("class_sessions")
    .select("id,starts_at,coach_id,classes!inner(title)")
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .is("coach_confirmed_at", null)
    .is("coach_arrived_at", null)
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + 10 * 60000).toISOString())
    .limit(50);
  for (const s of await withValidCoaches(unconfirmed ?? [])) {
    await escalateToFounders(
      "ops_coach_unconfirmed",
      "Coach hasn't confirmed",
      s,
      (name, title, when) =>
        `${name} still hasn't confirmed they're coming to ${title} (${when}) — it starts in ~10 min. A nudge or a backup plan may be worth it.`
    );
  }

  // Bounded to the last hour so we never backfill old sessions. 10-minute
  // grace: coaches typically tap "arrived" right around start time — only
  // escalate when the class is 10+ minutes in with still no arrival mark. Copy
  // branches on whether the coach ever confirmed: a confirmed-then-silent coach
  // is more urgent (they promised) than one who never answered.
  const { data: notArrived } = await supabase
    .from("class_sessions")
    .select("id,starts_at,coach_id,coach_confirmed_at,classes!inner(title)")
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .is("coach_arrived_at", null)
    .lte("starts_at", new Date(now - 10 * 60000).toISOString())
    .gt("starts_at", new Date(now - 70 * 60000).toISOString())
    .limit(50);
  for (const s of await withValidCoaches(notArrived ?? [])) {
    const confirmed = !!s.coach_confirmed_at;
    await escalateToFounders(
      "ops_coach_not_arrived",
      "Coach not marked arrived",
      s,
      confirmed
        ? (name, title, when) =>
            `${name} confirmed they were coming to ${title} (${when}) but hasn't marked arrival 10+ minutes in — call them now.`
        : (name, title, when) =>
            `${title} (${when}) is 10+ minutes in and ${name} never responded at all today — likely a no-show, act now.`
    );
  }
}

async function escalateToFounders(
  type: string,
  title: string,
  s: { id: string; starts_at: string; coach_id: string; classes: unknown },
  body: (coachName: string, classTitle: string, when: string) => string
) {
  const { data: done } = await supabase
    .from("notifications")
    .select("id")
    .eq("type", type)
    .eq("data->>session_id", s.id)
    .limit(1);
  if (done?.length) return;

  const { data: founders } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "founder");
  if (!founders?.length) return;

  const { data: coach } = await supabase
    .from("profiles")
    .select("full_name,phone")
    .eq("id", s.coach_id)
    .maybeSingle();
  const coachName = (coach?.full_name ?? "The coach").trim() || "The coach";
  const when = fmtDayClock(s.starts_at);
  const text = body(coachName, titleOf(s.classes), when) + (coach?.phone ? ` (${coach.phone})` : "");

  await supabase.from("notifications").insert(
    founders.map((f) => ({
      user_id: f.id,
      type,
      title,
      body: text,
      data: { session_id: s.id, coach_id: s.coach_id, url: "/admin/schedule" },
    }))
  );
}

/**
 * Shortly after each class ends, send the coach ONE interactive summary: a
 * congratulations, their next class today (or a "you're done for the day"), and
 * a prompt to confirm attendance + add a per-student assessment note in the app.
 * A single message on purpose — keeps WhatsApp spend and noise down.
 */
async function sweepAfterClass() {
  const now = Date.now();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id,ends_at,coach_id,classes!inner(title)")
    .in("status", ["scheduled", "completed"])
    .not("coach_id", "is", null)
    .lt("ends_at", new Date(now).toISOString())
    .gt("ends_at", new Date(now - 2 * 3600000).toISOString())
    .limit(100);

  for (const s of await withValidCoaches(sessions ?? [])) {
    if (await alreadyFired("coach_after_class", s.id, s.coach_id)) continue;

    const title = titleOf(s.classes);

    // Next scheduled class for this coach, later the same IST day.
    const { data: next } = await supabase
      .from("class_sessions")
      .select("starts_at,classes!inner(title)")
      .eq("coach_id", s.coach_id)
      .eq("status", "scheduled")
      .gt("starts_at", s.ends_at)
      .lte("starts_at", endOfIstDay(s.ends_at))
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const nextSentence = next
      ? `Up next today: ${titleOf(next.classes)} at ${fmtClock(next.starts_at)}.`
      : "That's all your classes today — brilliant work, enjoy the rest of your day! 🎉";

    const url = `/coach/session/${s.id}`;
    const firstName = await firstNameOf(s.coach_id);

    await supabase.from("notifications").insert({
      user_id: s.coach_id,
      type: "coach_after_class",
      title: "Class complete 🎉",
      body: `Great work wrapping up ${title}, ${firstName}! ${nextSentence} Please confirm attendance and add a quick assessment note for each student: ${APP_URL}${url}`,
      data: {
        session_id: s.id,
        kind: "after_class",
        first_name: firstName,
        class_title: title,
        next_sentence: nextSentence,
        url,
      },
    });
  }
}

// Ops feed types → singular/plural labels for the digest line. Order here is
// the order they appear in the summary.
const OPS_DIGEST_LABELS: Record<string, [string, string]> = {
  ops_booking: ["booking", "bookings"],
  ops_cancellation: ["cancellation", "cancellations"],
  ops_attendance: ["attendance update", "attendance updates"],
  ops_payment: ["payment", "payments"],
  ops_membership: ["membership change", "membership changes"],
  ops_new_client: ["new client", "new clients"],
  ops_new_coach: ["new coach", "new coaches"],
  ops_player_added: ["new player", "new players"],
  ops_wa_linked: ["WhatsApp link", "WhatsApp links"],
  ops_credit_used: ["credit used", "credits used"],
  ops_coach_change: ["coach change", "coach changes"],
  ops_cover_claimed: ["cover claimed", "covers claimed"],
  ops_session_coach_invalid: ["session with a bad coach", "sessions with a bad coach"],
};

/**
 * Founder daily summary, once per IST day at/after 21:00 IST.
 *
 * This used to count FEED_ONLY notification rows and render one line ("12
 * bookings · 2 cancellations · 1 new client"). That answered a question nobody
 * was asking. It counted rows rather than events — "2 membership changes" reads
 * the same whether two families joined or two quit — and, worse, the two coach
 * escalations are not FEED_ONLY members, so the reliability incidents were
 * structurally excluded. On 29 Jul it reported "2 WhatsApp links" and omitted
 * all 15 coach incidents that day.
 *
 * It now reports what a founder actually needs at the end of a day: did the
 * coaches turn up, were they on time, and did they file the roster. Source is
 * founder_day_report() (migration 0056).
 *
 * On the shape: WhatsApp rejects newlines inside a template VARIABLE, but not in
 * a template BODY. That distinction is why the old digest was stuck on one line
 * — it had a single content variable. founder_daily_digest_v3 has a multi-line
 * body with one variable per line, so each line below must stay newline-free.
 */
async function sweepFounderDigest() {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: IST }).format(now)
  );
  if (hour < 21) return;

  const istDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: IST,
  }).format(now); // today's IST date, YYYY-MM-DD

  const { data: founders } = await supabase.from("profiles").select("id").eq("role", "founder");
  if (!founders?.length) return;

  const { data: report, error } = await supabase.rpc("founder_day_report", { p_date: istDate });
  if (error) return; // leave the day unreported rather than send a wrong summary
  const sessions = (report ?? []) as DayReportRow[];
  // Silent only when nothing was scheduled. A day where every session ran
  // cleanly is worth saying out loud — that is the founder's "all good".
  if (!sessions.length) return;

  const summary = summariseDay(sessions);

  for (const f of founders) {
    const { data: already } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", f.id)
      .eq("type", "ops_daily_digest")
      .eq("data->>date", istDate)
      .limit(1);
    if (already?.length) continue;

    await supabase.from("notifications").insert({
      user_id: f.id,
      type: "ops_daily_digest",
      title: "Today at the academy",
      // The in-app and plain-text paths get the whole thing; " · " rather than
      // newlines so the generic template (one variable) stays legal too.
      body: `Coaches: ${summary.coaches} · Attendance: ${summary.attendance} · ${summary.attention}`,
      data: {
        date: istDate,
        coaches: summary.coaches,
        attendance: summary.attendance,
        attention: summary.attention,
        url: "/admin/schedule",
      },
    });
  }
}

type DayReportRow = {
  class_title: string;
  coach_name: string;
  time_str: string;
  arrived_at: string | null;
  minutes_late: number | null;
  arrival_source: string | null;
  roster_size: number;
  roster_marked: number;
};

/** How late a coach can be before it is worth the founder's attention. */
const LATE_THRESHOLD_MIN = 5;

/**
 * Three newline-free lines: punctuality, roster completion, and the exceptions
 * worth acting on. Names are used deliberately — "1 coach was late" is a
 * statistic, "Augustine 12 min late (Beginners Batch)" is something you can ring
 * someone about.
 */
function summariseDay(rows: DayReportRow[]): {
  coaches: string;
  attendance: string;
  attention: string;
} {
  const total = rows.length;
  const late = rows.filter((r) => (r.minutes_late ?? 0) >= LATE_THRESHOLD_MIN);
  const missing = rows.filter((r) => r.arrived_at === null);
  const onTime = total - late.length - missing.length;

  const coaches =
    `${onTime} of ${total} ${total === 1 ? "session" : "sessions"} started on time` +
    (late.length
      ? ` · ${late
          .slice(0, 3)
          .map((r) => `${r.coach_name} ${r.minutes_late} min late (${r.class_title})`)
          .join(" · ")}${late.length > 3 ? ` · +${late.length - 3} more` : ""}`
      : "");

  // A session with nobody booked has no roster to mark, so it can't count
  // against a coach — otherwise a quiet day reads as a day of neglect.
  const withRoster = rows.filter((r) => r.roster_size > 0);
  const marked = withRoster.filter((r) => r.roster_marked >= r.roster_size);
  const blank = withRoster.filter((r) => r.roster_marked === 0);
  const attendance = withRoster.length
    ? `${marked.length} of ${withRoster.length} rosters marked` +
      (blank.length ? ` · ${blank.length} left blank` : "")
    : "no rosters to mark";

  // Never marking arrival at all is the one that needs a name and a nudge: the
  // parents were told nothing, and the founder was escalated at start+10.
  const parts: string[] = [];
  for (const r of missing.slice(0, 3)) {
    parts.push(`${r.coach_name} never marked arrival (${r.class_title}, ${r.time_str})`);
  }
  if (missing.length > 3) parts.push(`+${missing.length - 3} more unmarked`);
  for (const r of blank.slice(0, 2)) {
    parts.push(`${r.class_title} roster still blank`);
  }
  const attention = parts.length ? parts.join(" · ") : "Nothing — a clean day.";

  return { coaches, attendance, attention };
}

/** Count ops rows by type and render the one-line summary (zeros omitted). */
function summariseOps(types: string[]): string {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  const parts: string[] = [];
  for (const [key, [one, many]] of Object.entries(OPS_DIGEST_LABELS)) {
    const n = counts.get(key) ?? 0;
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return parts.join(" · ");
}

// ── Morning briefings + the two time-driven dead types ──────────────────────
//
// Everything else the academy sends is a prompt to act NOW. The two briefings
// below are the only messages that exist to *plan* a day with, which is why
// they run at 07:00 IST and why both are deliberately absent from DEFERRABLE
// (see the note there): holding a 07:00 briefing to 08:00 destroys the lead
// time that is the entire reason for sending it.

/** Today's IST calendar date plus the UTC bounds of that IST day. */
function istDay(now: Date) {
  const istDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: IST,
  }).format(now);
  return {
    istDate,
    dayStart: new Date(`${istDate}T00:00:00+05:30`).toISOString(),
    dayEnd: new Date(`${istDate}T23:59:59+05:30`).toISOString(),
  };
}

/** Hour on the IST clock, 0-23. */
function istHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: IST }).format(now)
  );
}

/** "Sat 12 Jul" in IST. */
function fmtDayIST(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: IST,
  }).format(new Date(iso));
}

/** True if this (user, type) already got a message stamped with this IST date. */
async function alreadyBriefed(userId: string, type: string, stamp: string, key = "date") {
  const { data } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type)
    .eq(`data->>${key}`, stamp)
    .limit(1);
  return !!data?.length;
}

/** Confirmed/attended headcount per session id, in one query rather than N. */
async function headcounts(sessionIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!sessionIds.length) return counts;
  const { data } = await supabase
    .from("bookings")
    .select("session_id")
    .in("session_id", sessionIds)
    .in("status", ["confirmed", "attended"])
    .limit(5000);
  for (const b of (data ?? []) as { session_id: string }[]) {
    counts.set(b.session_id, (counts.get(b.session_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Coach morning briefing — 07:00 IST, one message per coach with sessions today.
 *
 * Closes the gap that a coach's earliest warning about any session is T-60,
 * which is useless for planning travel between a venue, a school and a private
 * address. Sends nothing on a day with no sessions.
 */
async function sweepCoachDayAhead() {
  const now = new Date();
  if (istHour(now) < 7) return;
  const { istDate, dayStart, dayEnd } = istDay(now);

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(`id,starts_at,coach_id,classes!inner(${CLASS_LOCATION_SELECT})`)
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd)
    .order("starts_at")
    .limit(500);
  if (!sessions?.length) return;

  const valid = await withValidCoaches(sessions);
  const byCoach = new Map<string, typeof valid>();
  for (const s of valid) {
    const arr = byCoach.get(s.coach_id) ?? [];
    arr.push(s);
    byCoach.set(s.coach_id, arr);
  }

  const counts = await headcounts(valid.map((s) => s.id));

  for (const [coachId, list] of byCoach) {
    if (await alreadyBriefed(coachId, "coach_day_ahead", istDate)) continue;

    const lines = list.map((s) => {
      const { title, location } = locationOf(s.classes);
      const n = counts.get(s.id) ?? 0;
      return `${fmtClock(s.starts_at)} · ${title}${location ? ` · ${location}` : ""} · ${n} student${n === 1 ? "" : "s"}`;
    });
    const firstName = await firstNameOf(coachId);
    const head = `${list.length} session${list.length === 1 ? "" : "s"} · first at ${fmtClock(list[0].starts_at)}`;

    await supabase.from("notifications").insert({
      user_id: coachId,
      type: "coach_day_ahead",
      title: `Your day — ${fmtDayIST(list[0].starts_at)}`,
      body: `Hi ${firstName}! ${head}\n${lines.join("\n")}\nReply here if anything looks wrong.`,
      data: {
        date: istDate,
        first_name: firstName,
        session_count: list.length,
        session_ids: list.map((s) => s.id),
        summary: head,
        schedule: lines.join(" · "),
        url: "/coach",
      },
    });
  }
}

/**
 * Founder morning briefing — 07:00 IST. What's scheduled and what's missing,
 * while both are still changeable. The 21:00 digest reports the same day after
 * nothing can be done about it.
 *
 * "Needs you" leads because it is the only part that is actionable: sessions
 * with no coach, and members still waiting on an approval decision.
 */
async function sweepFounderMorningBrief() {
  const now = new Date();
  if (istHour(now) < 7) return;
  const { istDate, dayStart, dayEnd } = istDay(now);

  const { data: founders } = await supabase.from("profiles").select("id").eq("role", "founder");
  if (!founders?.length) return;

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(`id,starts_at,coach_id,classes!inner(${CLASS_LOCATION_SELECT})`)
    .eq("status", "scheduled")
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd)
    .order("starts_at")
    .limit(500);

  const { count: pendingSignups } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("approval_status", "pending");

  const list = sessions ?? [];
  // Nothing scheduled and nobody waiting → say nothing at all.
  if (!list.length && !pendingSignups) return;

  const counts = await headcounts(list.map((s) => s.id));
  const unassigned = list.filter((s) => !s.coach_id);
  const students = list.reduce((n, s) => n + (counts.get(s.id) ?? 0), 0);

  const problems: string[] = [];
  for (const s of unassigned) {
    const { title } = locationOf(s.classes);
    problems.push(`${title} ${fmtClock(s.starts_at)} has NO coach`);
  }
  if (pendingSignups) {
    problems.push(`${pendingSignups} signup${pendingSignups === 1 ? "" : "s"} waiting on you`);
  }

  const lines = list.map((s) => {
    const { title, location } = locationOf(s.classes);
    const n = counts.get(s.id) ?? 0;
    return `${fmtClock(s.starts_at)} · ${title}${location ? ` · ${location}` : ""} · ${s.coach_id ? "" : "— "}${n} booked`;
  });

  const head = list.length
    ? `${list.length} session${list.length === 1 ? "" : "s"} · ${students} student${students === 1 ? "" : "s"}`
    : "No sessions today";

  const body = [
    head,
    problems.length ? `Needs you: ${problems.join(" · ")}` : null,
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");

  for (const f of founders) {
    if (await alreadyBriefed(f.id, "founder_morning_brief", istDate)) continue;
    await supabase.from("notifications").insert({
      user_id: f.id,
      type: "founder_morning_brief",
      title: `Today — ${istDate}`,
      body,
      data: {
        date: istDate,
        session_count: list.length,
        student_count: students,
        unassigned_count: unassigned.length,
        pending_signups: pendingSignups ?? 0,
        summary: head,
        url: "/admin",
      },
    });
  }
}

/**
 * `renewal_upcoming` — 3 days before a plan renews. The toggle for this has
 * existed in the profile UI since the grouped-prefs rework with nothing behind
 * it. A heads-up is also the cheapest possible prevention for the
 * `payment_failed` path that already exists.
 *
 * Deliberately skips `cancel_at_period_end` — telling someone who already
 * cancelled that they're about to be charged is alarming and wrong.
 */
async function sweepRenewalReminders() {
  const now = Date.now();
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("id,client_id,current_period_end,plans!inner(name)")
    .eq("status", "active")
    .eq("cancel_at_period_end", false)
    .gte("current_period_end", new Date(now + 3 * 86400000).toISOString())
    .lt("current_period_end", new Date(now + 4 * 86400000).toISOString())
    .limit(200);

  for (const s of (subs ?? []) as {
    id: string;
    client_id: string;
    current_period_end: string;
    plans: { name?: string } | null;
  }[]) {
    // Keyed on the period, not the day, so a retried sweep can't double-send.
    if (await alreadyBriefed(s.client_id, "renewal_upcoming", s.current_period_end, "period_end")) {
      continue;
    }
    const plan = s.plans?.name ?? "your plan";
    const when = fmtDayIST(s.current_period_end);
    await supabase.from("notifications").insert({
      user_id: s.client_id,
      type: "renewal_upcoming",
      title: "Renewing soon",
      body: `Your ${plan} renews on ${when}. Nothing to do if your card's still good.`,
      data: {
        subscription_id: s.id,
        period_end: s.current_period_end,
        plan_name: plan,
        renews_on: when,
        url: "/app/billing",
      },
    });
  }
}

/**
 * `monthly_progress` — one summary per player, in the first week of the month.
 *
 * The retention artefact: it turns a subscription into a story, and it is
 * composed entirely from data that already exists. Runs from the 1st to the 7th
 * IST so a missed cron day still delivers, and stamps `data.month` so a player
 * gets exactly one per month however many times it runs.
 */
async function sweepMonthlyProgress() {
  const now = new Date();
  if (istHour(now) < 9) return; // not at 2am, and after the morning briefings
  const { istDate } = istDay(now);
  const [y, m, d] = istDate.split("-").map(Number);
  if (d > 7) return;

  // The month being reported on is the one that just ended.
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const stamp = `${prevY}-${String(prevM).padStart(2, "0")}`;
  const from = new Date(`${stamp}-01T00:00:00+05:30`).toISOString();
  const to = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+05:30`).toISOString();

  const { data: attended } = await supabase
    .from("bookings")
    .select("player_id,client_id,class_sessions!inner(starts_at)")
    .eq("status", "attended")
    .gte("class_sessions.starts_at", from)
    .lt("class_sessions.starts_at", to)
    .limit(5000);
  if (!attended?.length) return;

  const perPlayer = new Map<string, { client: string; n: number }>();
  for (const b of attended as { player_id: string; client_id: string | null }[]) {
    if (!b.client_id || !b.player_id) continue;
    const cur = perPlayer.get(b.player_id) ?? { client: b.client_id, n: 0 };
    cur.n++;
    perPlayer.set(b.player_id, cur);
  }

  for (const [playerId, { client, n }] of perPlayer) {
    if (await alreadyBriefed(client, "monthly_progress", `${stamp}:${playerId}`, "month_player")) {
      continue;
    }
    const { data: player } = await supabase
      .from("players")
      .select("full_name")
      .eq("id", playerId)
      .maybeSingle();
    const first = (player?.full_name ?? "Your player").split(" ")[0];

    const { count: assessments } = await supabase
      .from("skill_assessments")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .gte("created_at", from)
      .lt("created_at", to);

    await supabase.from("notifications").insert({
      user_id: client,
      type: "monthly_progress",
      title: `${first}'s month at the academy`,
      body:
        `${first} attended ${n} session${n === 1 ? "" : "s"} last month` +
        (assessments ? ` and was assessed ${assessments} time${assessments === 1 ? "" : "s"}` : "") +
        `. See the full progress report in the app.`,
      data: {
        month: stamp,
        month_player: `${stamp}:${playerId}`,
        player_id: playerId,
        player_name: first,
        sessions_attended: n,
        assessment_count: assessments ?? 0,
        url: "/app/players",
      },
    });
  }
}

/** True if a notification of `type` for this (session, user) already exists. */
async function alreadyFired(type: string, sessionId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("notifications")
    .select("id")
    .eq("type", type)
    .eq("user_id", userId)
    .eq("data->>session_id", sessionId)
    .limit(1);
  return !!data?.length;
}

function titleOf(classes: unknown): string {
  const c = classes as { title?: string } | { title?: string }[] | null;
  return (Array.isArray(c) ? c[0]?.title : c?.title) ?? "a session";
}

async function firstNameOf(userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return (data?.full_name ?? "").trim().split(/\s+/)[0] || "Coach";
}

function fmtClock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(new Date(iso));
}

function fmtDayClock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(new Date(iso));
}

/** ISO instant for 23:59:59 IST on the same calendar day as `iso`. */
function endOfIstDay(iso: string): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: IST,
  }).format(new Date(iso)); // YYYY-MM-DD
  return new Date(`${date}T23:59:59+05:30`).toISOString();
}

async function sweepWaitlistOffers() {
  const { data: settings } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "waitlist_claim_minutes")
    .maybeSingle();
  const claimMinutes = Number(settings?.value ?? 15);
  const cutoff = new Date(Date.now() - claimMinutes * 60000).toISOString();

  const { data: expired } = await supabase
    .from("notifications")
    .select("id,user_id,data")
    .eq("type", "waitlist_spot")
    .eq("status", "sent")
    .lt("sent_at", cutoff)
    .is("read_at", null)
    .limit(20);

  for (const offer of expired ?? []) {
    const sessionId = offer.data?.session_id;
    if (!sessionId) continue;
    // Mark the stale offer read so it isn't re-swept.
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", offer.id);
    // Next in line who hasn't been offered yet.
    const { data: next } = await supabase
      .from("bookings")
      .select("id,client_id,waitlist_position")
      .eq("session_id", sessionId)
      .eq("status", "waitlisted")
      .order("waitlist_position", { ascending: true })
      .limit(5);
    const alreadyOffered = new Set([offer.user_id]);
    const candidate = (next ?? []).find((b) => !alreadyOffered.has(b.client_id));
    if (candidate) {
      // The fourth waitlist insert site (G4). Like the three in SQL, this one
      // carried no class_title and no claim_minutes, so the template could only
      // say "a spot just opened in a class" with a hardcoded 15 minutes.
      const { data: session } = await supabase
        .from("class_sessions")
        .select("classes!inner(title)")
        .eq("id", sessionId)
        .maybeSingle();

      await supabase.from("notifications").insert({
        user_id: candidate.client_id,
        type: "waitlist_spot",
        title: "A spot opened",
        body: `Claim it within ${claimMinutes} minutes.`,
        data: {
          session_id: sessionId,
          booking_id: candidate.id,
          class_title: titleOf(session?.classes),
          claim_minutes: claimMinutes,
          url: `/app/book/class/${sessionId}`,
        },
      });
    }
  }
}

/**
 * Outcome of one delivery attempt. `channel` is what actually carried it, or
 * the last channel we tried when nothing did ("push" | "whatsapp" | "email" |
 * "none"); `error` is the accumulated reason chain, written to
 * notifications.error so a failed row explains itself.
 * (notification-fix-plan 1.5.)
 *
 * Since push arrived it can also be compound — "push+whatsapp", "push+email" —
 * for the PUSH_ADDITIVE types, where both legs are sent on purpose. Anything
 * reading this column should treat it as a set, not an enum: `= 'push'` means
 * push ALONE, which is why deliveredTodayCount can exclude it safely.
 */
/**
 * `note` is the reason a *preferred* channel was skipped on a delivery that
 * nonetheless succeeded — "whatsapp: not_configured" on a row that went out by
 * email. It exists because losing that sentence once cost four days: when
 * Twilio ran dry on 2026-08-02 the email fallback covered every message, so
 * nothing was ever marked failed, and the reason lived only in an edge-function
 * log that rolls over after 24 hours. `channel_attempted` could tell you a
 * linked member had been downgraded to email; nothing could tell you why.
 */
type Attempt = { ok: boolean; channel: string; error?: string; note?: string };

/**
 * Push needs one extra bit that no other channel does. `ok` answers "may this
 * end the chain?", which for push means a device somebody still opens took it
 * (see PUSH_FRESH_MS). `accepted` answers "did a banner go out at all?", which
 * is what the compound channel label should record — a push that reached only a
 * long-dormant browser is still a push, it just isn't a reason to skip the
 * WhatsApp.
 */
type PushAttempt = Attempt & { accepted: boolean };

/**
 * K8 — offer any uncovered upcoming session to every eligible coach.
 *
 * handle_coach_dropout already offers cover when its own cascade can't refill a
 * session, but sessions arrive with no coach by other routes too (a move that
 * cleared the coach, an engine pass that found nobody, a founder unassigning
 * one). This sweep is the catch-all, so an uncovered session is never sitting
 * silently waiting for the founder to notice it.
 *
 * offer_cover_session is idempotent per (coach, session) and returns 0 for a
 * session that's since been covered, so re-sweeping is free.
 */
async function sweepCoverOffers() {
  const now = Date.now();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("status", "scheduled")
    .is("coach_id", null)
    // Not the far future: a session three weeks out has time to be assigned
    // normally, and offering it now just adds noise.
    .gt("starts_at", new Date(now + 60 * 60000).toISOString())
    .lt("starts_at", new Date(now + 48 * 3600000).toISOString())
    .limit(25);

  for (const s of sessions ?? []) {
    await supabase.rpc("offer_cover_session", { p_session: s.id });
  }
}

async function deliver(row: {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: { url?: string } & Record<string, unknown>;
}): Promise<Attempt> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("email,full_name")
    .eq("id", row.user_id)
    .maybeSingle();
  const firstName = (profile?.full_name ?? "").trim().split(/\s+/)[0] || "there";

  // Push first, because it is instant and costs nothing — but see PUSH_ADDITIVE:
  // for the time-critical set it does NOT end the chain, it runs alongside it.
  // `push.ok` means a device we have reason to believe somebody still opens
  // accepted it; `push.accepted` means some endpoint took it. The two differ
  // exactly when every subscription this person has is stale, which is the case
  // the freshness rule exists for.
  const push = await deliverPush(row);
  // Only a *rejected* push is worth writing down. deliverPush reports channel
  // "none" for the two states that are simply normal — no keys configured, or a
  // person who has never subscribed — and stamping those on every failed row
  // would bury the reason that actually explains the failure.
  const notes: string[] = push.channel === "push" && push.error ? [`push: ${push.error}`] : [];
  if (push.ok && !PUSH_ADDITIVE.has(row.type)) return { ok: true, channel: "push" };

  /** Push already carried it, so a dead fallback isn't a failed notification. */
  const orPush = (attempt: Attempt): Attempt =>
    push.ok ? { ok: true, channel: "push" } : attempt;

  /** What to call the channel once a later leg lands. */
  const withPush = (channel: string) => (push.accepted ? `push+${channel}` : channel);

  // WhatsApp for linked users. Inside the 24h service window we send rich
  // free-form text; outside it we fall back to the approved template (with the
  // member's name), and only then to email.
  const wa = await deliverWhatsApp(row, firstName);
  if (wa.ok) return { ok: true, channel: withPush("whatsapp"), note: notes.join("; ") || undefined };
  if (wa.error) notes.push(`whatsapp: ${wa.error}`);

  // Email fallback via Resend.
  //
  // Previously an unset RESEND_API_KEY returned `true` here — every undeliverable
  // row was silently recorded as sent (G8). Now it fails honestly so the row
  // carries `no_channel` and shows up in the failure query.
  if (!RESEND_KEY) {
    notes.push("email: no_channel");
    return orPush({ ok: false, channel: wa.channel, error: notes.join("; ") });
  }
  if (!profile?.email) {
    notes.push("email: no_address");
    return orPush({ ok: false, channel: wa.channel, error: notes.join("; ") });
  }

  const deepLink = `${Deno.env.get("APP_URL") ?? "http://localhost:3000"}${row.data?.url ?? "/app"}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: profile.email,
      subject: row.title,
      html: `
        <div style="background:#0B0C0F;padding:32px;font-family:Inter,system-ui,sans-serif">
          <div style="max-width:480px;margin:0 auto;background:#14161B;border:1px solid #26282E;border-radius:12px;padding:28px">
            <p style="color:#E8590C;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 12px">Sharwin TTA</p>
            <h1 style="color:#F4F1EA;font-size:22px;margin:0 0 8px">${row.title}</h1>
            <p style="color:#A3A7B0;font-size:15px;margin:0 0 24px">${row.body}</p>
            <a href="${deepLink}" style="display:inline-block;background:#E8590C;color:#F4F1EA;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px">Open</a>
          </div>
        </div>`,
    }),
  });
  // The row went out, so this is not a failure — but WhatsApp was preferred and
  // did not carry it, and that sentence is the whole diagnosis. Keep it.
  if (res.ok) return { ok: true, channel: withPush("email"), note: notes.join("; ") || undefined };
  const detail = (await res.text().catch(() => "")).slice(0, 200);
  notes.push(`email: ${res.status} ${detail}`.trim());
  return orPush({ ok: false, channel: "email", error: notes.join("; ") });
}

// ---------------------------------------------------------------------------
// Web push
//
// The leg that was missing for two years. push_subscriptions, its RLS, the
// browser subscribe flow and the service worker's push handler all existed and
// all worked; nothing ever signed a VAPID token and POSTed to an endpoint, so
// the table sat at zero rows against 55 profiles and not one push was ever
// attempted. RFC 8291 (payload encryption) and RFC 8292 (the VAPID JWT) are
// handled by jsr:@negrel/webpush — hand-rolling AES128GCM + HKDF + ECDH here
// would be a fine way to ship a bug nobody can see, since a botched envelope
// fails as a silent 400 from the push service, not as an error anyone reads.
// ---------------------------------------------------------------------------

// Built once per worker instance and reused across the batch: importing the
// keys and generating the ECDH pair is real work, and a busy tick sends to
// dozens of endpoints. Cached as the promise, not the value, so two concurrent
// callers share one build.
let pushServerOnce: Promise<webpush.ApplicationServer | null> | null = null;

function applicationServer(): Promise<webpush.ApplicationServer | null> {
  if (!pushServerOnce) pushServerOnce = buildApplicationServer();
  return pushServerOnce;
}

async function buildApplicationServer(): Promise<webpush.ApplicationServer | null> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  try {
    // The keys are stored the way the browser wants them (raw base64url); the
    // library wants JWK. x and y are just the two halves of the uncompressed
    // point, so the conversion is a slice, not a computation.
    const point = b64uBytes(VAPID_PUBLIC_KEY);
    if (point.length !== 65 || point[0] !== 0x04) {
      throw new Error("VAPID_PUBLIC_KEY is not a base64url raw P-256 point");
    }
    const x = b64uText(point.slice(1, 33));
    const y = b64uText(point.slice(33, 65));
    // Round-tripped rather than used as-is, so a key pasted with padding or in
    // standard base64 still imports — JWK accepts unpadded base64url only.
    const d = b64uText(b64uBytes(VAPID_PRIVATE_KEY));

    const vapidKeys = await webpush.importVapidKeys(
      {
        publicKey: { kty: "EC", crv: "P-256", x, y },
        privateKey: { kty: "EC", crv: "P-256", x, y, d },
      },
      { extractable: false }
    );
    return await webpush.ApplicationServer.new({
      contactInformation: VAPID_SUBJECT,
      vapidKeys,
    });
  } catch (err) {
    // Loud in the logs, quiet in production: a malformed key disables push and
    // leaves WhatsApp and email exactly as they were.
    console.error("notify: VAPID keys unusable — push disabled", err);
    return null;
  }
}

/**
 * Send one notification to every device this person has subscribed. Returns the
 * same Attempt shape as the other deliverers so `channel_attempted` gets
 * stamped and a failure explains itself, plus `accepted` — see PUSH_FRESH_MS.
 *
 * Fans out rather than picking one: a coach has a phone and often a laptop, and
 * we have no idea which one is in their hand. One endpoint that we last heard
 * from recently accepting is enough to call it delivered; an endpoint nobody
 * has opened in a month gets the push but is not allowed to end the chain.
 */
async function deliverPush(row: {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: { url?: string } & Record<string, unknown>;
}): Promise<PushAttempt> {
  const server = await applicationServer();
  if (!server) return { ok: false, accepted: false, channel: "none", error: "not_configured" };

  // Service-role client, so the "own push subscriptions" RLS policy doesn't
  // apply — the worker sends on someone's behalf, it doesn't read as them.
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,last_seen_at")
    .eq("user_id", row.user_id);
  if (!subs?.length) {
    return { ok: false, accepted: false, channel: "none", error: "no_subscription" };
  }

  const d = row.data ?? {};
  const urgent = PUSH_ADDITIVE.has(row.type);
  const payload = JSON.stringify({
    title: row.title,
    // Push services cap the encrypted payload (4KB on most, less on some), and
    // an over-long body is rejected wholesale rather than truncated. Nothing we
    // send is near this; the slice is so a future long one degrades instead.
    body: (row.body ?? "").slice(0, 500),
    tag: pushTagFor(row.type, d, row.id),
    actions: pushActionsFor(row.type, d),
    data: {
      url: String(d.url ?? "/app"),
      type: row.type,
      session_id: d.session_id ?? null,
      notification_id: row.id,
    },
  });

  const freshAfter = Date.now() - PUSH_FRESH_MS;
  let delivered = 0;
  let deliveredFresh = 0;
  const notes: string[] = [];
  for (const sub of subs) {
    try {
      await server
        .subscribe({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        })
        .pushTextMessage(payload, {
          urgency: urgent ? webpush.Urgency.High : webpush.Urgency.Normal,
          // A "your class starts in an hour" that surfaces tomorrow morning is
          // worse than one that never arrives, so the urgent set expires in an
          // hour. The rest keeps a day, in case a phone is off overnight.
          ttl: urgent ? 3600 : 86400,
        });
      delivered++;
      if (new Date(sub.last_seen_at).getTime() >= freshAfter) deliveredFresh++;
    } catch (err) {
      const status = err instanceof webpush.PushMessageError ? err.response.status : 0;
      if (status === 404 || status === 410) {
        // The browser threw this subscription away (uninstalled, cleared site
        // data, rotated endpoint). Dead endpoints are the reason push tables
        // rot, so it self-cleans here rather than failing forever.
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        notes.push(`gone_${status}`);
      } else {
        notes.push(status ? String(status) : String(err).slice(0, 80));
      }
    }
  }

  if (deliveredFresh > 0) return { ok: true, accepted: true, channel: "push" };
  // Accepted, but only by devices nobody has opened in a month. The push is out
  // there; we just refuse to let it stand in for the WhatsApp.
  if (delivered > 0) {
    return { ok: false, accepted: true, channel: "push", error: "stale_endpoints_only" };
  }
  return {
    ok: false,
    accepted: false,
    channel: "push",
    error: notes.join(", ") || "no_endpoint_accepted",
  };
}

/**
 * Drop subscriptions no browser has re-upserted in PUSH_STALE_MS. PushToggle
 * refreshes on every mount, so anything this old belongs to a browser profile
 * nobody opens — and keeping it costs a wasted encrypt-and-POST per message
 * plus a row that makes the push table look healthier than it is.
 */
async function sweepStalePushSubscriptions() {
  await supabase
    .from("push_subscriptions")
    .delete()
    .lt("last_seen_at", new Date(Date.now() - PUSH_STALE_MS).toISOString());
}

// The three prompts one coach gets about one session, in the order they arrive.
// They share a tag on purpose — see pushTagFor.
const COACH_SESSION_PROMPTS = new Set([
  "coach_before_class",
  "coach_confirm_nudge_2",
  "coach_arrival_check",
]);

/**
 * The tray tag — which banner a new one replaces.
 *
 * This used to be `${type}:${session}` with a comment claiming it stopped three
 * reminders about one 6:30 session stacking up. It did the opposite: those
 * three prompts are three different TYPES, so they got three different tags and
 * stacked exactly as described, while alreadyFired() already guarantees one row
 * per (type, session, coach) — so the tag could never collide and `renotify`
 * never fired. A mechanism that was inert while its comment described it as the
 * fix.
 *
 * Keyed on the session for the coach prompt family, it now does the thing:
 * "have you reached?" replaces "are you coming?" instead of sitting under it,
 * and a coach glancing at a lock screen sees the question we want answered now
 * rather than three of them. Everything else keeps the per-type key, where the
 * tag is only a safety net against a duplicate that alreadyFired() missed.
 */
function pushTagFor(type: string, d: Record<string, unknown>, id: string): string {
  const session = d.session_id ? String(d.session_id) : null;
  if (session && COACH_SESSION_PROMPTS.has(type)) return `coach:${session}`;
  return `${type}:${String(d.session_id ?? d.booking_id ?? id)}`;
}

/**
 * The buttons on a push notification — the push mirror of
 * interactiveContentFor(), keyed off the same types and worded the same way, so
 * a coach who has been tapping "Yes, I'm coming" in WhatsApp finds the same
 * words on their lock screen.
 *
 * Two deliberate limits. Browsers render at most two (the service worker caps
 * to whatever Notification.maxActions says), and WebKit renders none at all —
 * so every one of these is also reachable by tapping the notification body and
 * landing on data.url, which is the only path an iPhone ever takes.
 *
 * "Can't make it" is an `open`, not an action: it starts a cover search and
 * can't be undone from a tray, which is why WhatsApp asks a second question
 * before committing it. It opens the session screen, where that confirm step
 * already lives. Anything without a session_id gets no buttons, because there
 * would be nothing for the server to act on.
 */
function pushActionsFor(
  type: string,
  d: Record<string, unknown>
): { action: string; title: string }[] {
  if (!d.session_id) return [];
  switch (type) {
    case "coach_before_class":
    case "coach_confirm_nudge_2":
      return [
        { action: "coach_confirm", title: "Yes, I'm coming" },
        { action: "open", title: "Can't make it" },
      ];
    case "coach_arrival_check":
      return [
        { action: "coach_arrived", title: "I've arrived" },
        { action: "coach_late", title: "Running late" },
      ];
    default:
      return [];
  }
}

/** base64url (padded or not, standard or url alphabet) → bytes. */
function b64uBytes(value: string): Uint8Array {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised + "=".repeat((4 - (normalised.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** bytes → unpadded base64url, the only spelling JWK accepts. */
function b64uText(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function deliverWhatsApp(
  row: {
    id: string;
    user_id: string;
    type: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
  },
  firstName: string
): Promise<Attempt> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return { ok: false, channel: "none", error: "not_configured" };
  }

  const { data: link } = await supabase
    .from("wa_links")
    .select("phone")
    .eq("user_id", row.user_id)
    .maybeSingle();
  // The single biggest cause of the audit's ~300 failed rows for the second
  // founder account. Now it says so on the row instead of failing anonymously.
  if (!link?.phone) return { ok: false, channel: "none", error: "not_linked" };

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const notes: string[] = [];

  // Interactive templates (WhatsApp-approved) can be sent business-initiated at
  // any time, so they don't depend on the 24h service window. When one is
  // configured for this notification type, send it and record the outbound SID
  // on the row so an inbound button tap can be mapped back to the session.
  const interactive = interactiveContentFor(row, firstName);
  if (interactive) {
    const res = await twilioSend(endpoint, { To: `whatsapp:${link.phone}`, ...interactive });
    if (res.sid) {
      await supabase
        .from("notifications")
        .update({ data: { ...row.data, twilio_sid: res.sid } })
        .eq("id", row.id);
      return { ok: true, channel: "whatsapp" };
    }
    // Interactive send failed (e.g. template not approved yet) → fall through to
    // the plain-text paths below so the coach still gets the message. The reason
    // is kept so an unprovisioned SID is visible in the failure query.
    notes.push(`template ${res.error ?? "send_failed"}`);
  }

  // Is the user inside the 24h WhatsApp service window? (Did they message us
  // within the last day?) If so we may send free-form text.
  const { data: lastInbound } = await supabase
    .from("wa_messages")
    .select("created_at")
    .eq("phone", link.phone)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const inWindow =
    !!lastInbound && Date.now() - new Date(lastInbound.created_at).getTime() < WINDOW_MS;

  const fields: Record<string, string> = { To: `whatsapp:${link.phone}` };
  if (inWindow) {
    fields.Body = `*${row.title}*\n${row.body}`;
  } else if (TWILIO_TEMPLATE_SID) {
    // Business-initiated outside the window → approved Utility template.
    //
    // WhatsApp rejects newlines inside a template VARIABLE value (the body may
    // contain them, the variable may not), and silently 63016s the send. Every
    // message was single-line when this was written; the morning briefings are
    // not, so an unflattened brief would never reach anyone outside the 24h
    // window. Flatten to " · " and cap the length rather than lose the message.
    fields.ContentSid = TWILIO_TEMPLATE_SID;
    fields.ContentVariables = JSON.stringify({
      "1": firstName,
      "2": `${row.title} — ${row.body}`.replace(/\s*\n\s*/g, " · ").trim().slice(0, 900),
    });
  } else {
    // No template configured and outside the window: can't send free-form. This
    // is the generic TWILIO_WA_TEMPLATE_SID gap from 1.4 — name it explicitly.
    notes.push("outside_24h_window_and_no_generic_template");
    return { ok: false, channel: "whatsapp", error: notes.join("; ") };
  }
  const res = await twilioSend(endpoint, fields);
  if (res.sid) return { ok: true, channel: "whatsapp" };
  notes.push(res.error ?? "send_failed");
  return { ok: false, channel: "whatsapp", error: notes.join("; ") };
}

/**
 * Maps a notification type to an interactive Content template + its variables,
 * or null when no interactive template applies (or its SID isn't configured).
 * Variable order must match the template body defined in
 * scripts/whatsapp/provision-templates.mjs.
 */
function interactiveContentFor(
  row: { type: string; title: string; body: string; data: Record<string, unknown> },
  firstName: string
): Record<string, string> | null {
  const d = row.data ?? {};
  // Coach "Are you coming?" at T-60 → Yes / Can't make it buttons. {{3}} = time
  // + venue in one value ("6:30 pm at La Plazza") — WhatsApp rejects templates
  // with adjacent variables, so we can't use two here.
  if (row.type === "coach_before_class" && TWILIO_WA_COACH_COMING_SID) {
    return {
      ContentSid: TWILIO_WA_COACH_COMING_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.class_title ?? "your class"),
        "3": `${String(d.time_str ?? "")}${String(d.location_str ?? "")}`.trim() || "soon",
        // Trailing directions link. Ignored by the v1 templates (3 variables),
        // rendered by v2 — see mapsLine() above for why it isn't folded into
        // {{3}} or added as a button.
        "4": String(d.maps_url ?? ""),
      }),
    };
  }
  // Coach T-30 chase → the same Yes / Can't make it buttons as T-60. Distinct
  // template rather than a reuse of coach_coming_check: this rung only fires
  // when the coach has stayed silent, and it has to READ like a follow-up.
  // Sending the identical wording twice, half an hour apart, is what made the
  // ladder look broken even when it was working.
  if (row.type === "coach_confirm_nudge_2" && TWILIO_WA_COACH_NUDGE_SID) {
    return {
      ContentSid: TWILIO_WA_COACH_NUDGE_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.class_title ?? "your class"),
        "3": `${String(d.time_str ?? "")}${d.location_str ? `, ${String(d.location_str)}` : ""}`.trim() || "soon",
        "4": String(d.maps_url ?? ""),
      }),
    };
  }
  // Cover offer → one Claim button. The button id `cover_claim` has existed in
  // lib/whatsapp/interactive.ts since cover offers shipped, but no template ever
  // declared it, so claiming only ever worked by typing "claim". First tap still
  // wins: claim_cover_session settles the race with SELECT ... FOR UPDATE.
  if (row.type === "cover_offer" && TWILIO_WA_COACH_COVER_SID) {
    return {
      ContentSid: TWILIO_WA_COACH_COVER_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.class_title ?? "a session"),
        "3": `${String(d.time_str ?? "")}${d.location_str ? `, ${String(d.location_str)}` : ""}`.trim() || "soon",
        "4": String(d.maps_url ?? ""),
      }),
    };
  }
  // Coach "Have you reached?" at start → I've arrived / Running late buttons.
  if (row.type === "coach_arrival_check" && TWILIO_WA_COACH_ARRIVAL_SID) {
    return {
      ContentSid: TWILIO_WA_COACH_ARRIVAL_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.class_title ?? "your class"),
        "3": String(d.location_str ?? "the venue"),
        "4": String(d.maps_url ?? ""),
      }),
    };
  }
  // Parent: coach has arrived (no buttons). Coach name/location/time come from
  // the notification data coach_mark_arrival wrote. Gated on coach_name so the
  // founder's coach_late row (which lacks it) keeps its own free-form path.
  if (row.type === "coach_arrived" && TWILIO_WA_CLIENT_ARRIVED_SID && d.coach_name) {
    return {
      ContentSid: TWILIO_WA_CLIENT_ARRIVED_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.coach_name ?? "your coach"),
        "3": String(d.location_str ?? "the venue"),
        "4": String(d.time_str ?? "today"),
      }),
    };
  }
  // Parent: coach running late (no buttons). Gated on coach_name so the
  // founder's coach_late row keeps its own free-form path.
  if (row.type === "coach_late" && TWILIO_WA_CLIENT_LATE_SID && d.coach_name) {
    return {
      ContentSid: TWILIO_WA_CLIENT_LATE_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.coach_name ?? "your coach"),
        "3": String(d.time_str ?? "today"),
      }),
    };
  }
  if (row.type === "coach_after_class" && TWILIO_WA_COACH_AFTERCLASS_SID) {
    return {
      ContentSid: TWILIO_WA_COACH_AFTERCLASS_SID,
      ContentVariables: JSON.stringify({
        "1": String(d.class_title ?? "your class"),
        "2": String(d.next_sentence ?? ""),
        "3": `${APP_URL}${String(d.url ?? "/coach")}`,
      }),
    };
  }
  // Client: one consolidated reminder with "I'll be there / Can't make it".
  // {{4}} is the venue, written by the notify_name_the_session trigger. v1 of
  // the template declares only three variables and ignores it; v2 renders it.
  if (row.type === "reminder_upcoming" && TWILIO_WA_CLIENT_REMINDER_SID) {
    return {
      ContentSid: TWILIO_WA_CLIENT_REMINDER_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.class_title ?? "your session"),
        "3": String(d.time_str ?? "later today"),
        "4": String(d.location_str ?? "the usual venue"),
      }),
    };
  }
  // Client: waitlist spot with "Claim spot / Pass".
  if (row.type === "waitlist_spot" && TWILIO_WA_CLIENT_WAITLIST_SID) {
    return {
      ContentSid: TWILIO_WA_CLIENT_WAITLIST_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.class_title ?? "a class"),
        "3": String(d.claim_minutes ?? 15),
      }),
    };
  }
  // Client: payment failed → CTA to fix payment (static URL).
  if (row.type === "payment_failed" && TWILIO_WA_CLIENT_PAYMENT_SID) {
    return {
      ContentSid: TWILIO_WA_CLIENT_PAYMENT_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.plan_name ?? "your membership"),
      }),
    };
  }
  // Client: booking confirmed → CTA to view schedule (static URL).
  if (row.type === "booking_confirmed" && TWILIO_WA_CLIENT_BOOKED_SID) {
    return {
      ContentSid: TWILIO_WA_CLIENT_BOOKED_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(row.body ?? "You're booked").replace(/\s+/g, " ").trim(),
      }),
    };
  }
  // Coach: new private session → CTA to the session page (dynamic URL suffix).
  // Gated on the row carrying a /coach/ link, the way coach_arrived gates on
  // coach_name: this template is coach-worded and its CTA is a coach deep link,
  // so it must never render for a client row. The client copy now has its own
  // type (private_session_booked); this gate is the belt to that braces. (G1.)
  if (
    row.type === "new_private_session" &&
    TWILIO_WA_COACH_PRIVATE_SID &&
    String(d.url ?? "").startsWith("/coach/")
  ) {
    const sessionId = String(d.session_id ?? "");
    if (sessionId) {
      return {
        ContentSid: TWILIO_WA_COACH_PRIVATE_SID,
        ContentVariables: JSON.stringify({
          "1": firstName,
          "2": String(row.body ?? "a new session").replace(/\s+/g, " ").trim(),
          "3": sessionId,
        }),
      };
    }
  }
  // Founder: daily digest → CTA to the dashboard (static URL).
  if (row.type === "ops_daily_digest" && TWILIO_WA_FOUNDER_DIGEST_SID) {
    return {
      ContentSid: TWILIO_WA_FOUNDER_DIGEST_SID,
      ContentVariables: JSON.stringify({
        "1": String(d.date ?? ""),
        "2": String(d.summary ?? row.body ?? "").replace(/\s+/g, " ").trim(),
      }),
    };
  }
  // Founder: new signup request with Approve / Deny buttons. The outbound SID is
  // recorded on the row (shared path below) so a tap maps back to the applicant.
  if (row.type === "signup_request" && TWILIO_WA_FOUNDER_SIGNUP_SID) {
    return {
      ContentSid: TWILIO_WA_FOUNDER_SIGNUP_SID,
      ContentVariables: JSON.stringify({
        "1": String(d.applicant_name ?? "Someone"),
        "2": String(d.applicant_email ?? ""),
        "3": String(d.applicant_phone ?? ""),
      }),
    };
  }
  // Client: "you're approved" → CTA into the app (static URL).
  if (row.type === "signup_approved" && TWILIO_WA_CLIENT_APPROVED_SID) {
    return {
      ContentSid: TWILIO_WA_CLIENT_APPROVED_SID,
      ContentVariables: JSON.stringify({
        "1": String(d.first_name ?? firstName),
      }),
    };
  }
  return null;
}

/**
 * POST to Twilio Messages. Returns `{ sid }` on success, `{ error }` on failure
 * — Twilio's own numeric code + message where available (e.g.
 * "63016 failed to send freeform message"), which is what makes an
 * unprovisioned template distinguishable from a bad number on the failed row.
 */
async function twilioSend(
  endpoint: string,
  fields: Record<string, string>
): Promise<{ sid?: string; error?: string }> {
  const auth = `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: TWILIO_FROM!, ...fields }),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    console.error("twilio send failed", res.status, text);
    let detail = `${res.status}`;
    try {
      const json = JSON.parse(text) as { code?: number; message?: string };
      if (json.code || json.message) detail = `${json.code ?? res.status} ${json.message ?? ""}`.trim();
    } catch {
      if (text) detail = `${res.status} ${text}`;
    }
    return { error: detail };
  }
  const json = (await res.json().catch(() => null)) as { sid?: string } | null;
  return { sid: json?.sid ?? "sent" };
}
