// P11 — delivery worker. Deploy as a Supabase Edge Function on a 1-minute cron:
//   supabase functions deploy notify
//   select cron.schedule('notify-worker', '* * * * *', $$select net.http_post(
//     url := 'https://<ref>.supabase.co/functions/v1/notify',
//     headers := '{"Authorization": "Bearer <service-role-key>"}'::jsonb)$$);
//
// Claims due rows (skip-locked semantics via status flip), tries web push to
// every subscription, falls back to Resend email, marks sent/failed. After
// delivery it runs a set of sweeps (waitlist offers, coach prompts, founder
// escalations, after-class summaries).

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
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
const TWILIO_WA_COACH_REMINDER_SID = Deno.env.get("TWILIO_WA_COACH_REMINDER_SID");
const TWILIO_WA_COACH_AFTERCLASS_SID = Deno.env.get("TWILIO_WA_COACH_AFTERCLASS_SID");
const APP_URL = Deno.env.get("APP_URL") ?? "https://sharwinacademy.com";
const WINDOW_MS = 24 * 60 * 60 * 1000;
const IST = "Asia/Kolkata";

// Types that ignore user prefs (always deliver).
const TRANSACTIONAL = new Set(["payment_failed", "session_cancelled"]);

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
      await supabase
        .from("notifications")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending");
      continue;
    }
    seen.add(dedupeKey);

    // Prefs: non-transactional types respect profiles.notification_prefs.
    if (!TRANSACTIONAL.has(row.type)) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("notification_prefs")
        .eq("id", row.user_id)
        .maybeSingle();
      if (profile?.notification_prefs?.[row.type] === false) {
        await supabase
          .from("notifications")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("status", "pending");
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

    const delivered = await deliver(row);
    if (delivered) {
      sent++;
    } else {
      failed++;
      await supabase
        .from("notifications")
        .update({ status: "failed" })
        .eq("id", row.id);
    }
  }

  // Post-delivery sweeps. Each is isolated so one failure can't break the
  // others or the delivery loop above.
  await safeSweep("waitlist-offers", sweepWaitlistOffers);
  await safeSweep("before-class", sweepBeforeClass);
  await safeSweep("founder-escalations", sweepFounderEscalations);
  await safeSweep("after-class", sweepAfterClass);

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

// ---------------------------------------------------------------------------
// Coach prompts + founder escalations
//
// Philosophy: coaches drive their own class through interactive prompts; the
// founder is only pinged when an action is actually expected of them (a coach
// who hasn't confirmed as the class nears, is running late, or hasn't shown up)
// — never for happy-path status updates.
// ---------------------------------------------------------------------------

/**
 * 1 hour before each session, send the assigned coach ONE interactive reminder
 * with "I'm coming / I've arrived / Running late" buttons (falls back to text
 * until the WhatsApp template is provisioned — the inbound webhook also accepts
 * the same words typed out). Fires once per (coach, session) and targets the
 * whole next-60-min window, so a skipped cron tick still delivers.
 */
async function sweepBeforeClass() {
  const now = Date.now();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,coach_id,classes!inner(title,venues(name),private_class_details(address))"
    )
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + 60 * 60000).toISOString())
    .limit(100);

  for (const s of sessions ?? []) {
    if (await alreadyFired("coach_before_class", s.id, s.coach_id)) continue;

    const cls = s.classes as unknown as {
      title: string;
      venues: { name: string } | { name: string }[] | null;
      private_class_details: { address: string } | { address: string }[] | null;
    };
    const venue = Array.isArray(cls.venues) ? cls.venues[0] : cls.venues;
    const priv = Array.isArray(cls.private_class_details)
      ? cls.private_class_details[0]
      : cls.private_class_details;
    const location = venue?.name ?? priv?.address ?? "";
    const loc = location ? ` at ${location}` : "";
    const time = fmtClock(s.starts_at);
    const firstName = await firstNameOf(s.coach_id);

    await supabase.from("notifications").insert({
      user_id: s.coach_id,
      type: "coach_before_class",
      title: "Class reminder",
      body: `Hi ${firstName}! Reminder: ${cls.title} starts at ${time}${loc}. Reply "coming", "arrived", or "running late" to keep us posted.`,
      data: {
        session_id: s.id,
        kind: "before_class",
        first_name: firstName,
        class_title: cls.title,
        time_str: time,
        location_str: loc,
        url: `/coach/session/${s.id}`,
      },
    });
  }
}

/**
 * Founder escalations — only when the founder may need to act:
 *  (a) ~10 min before start and the coach still hasn't confirmed;
 *  (b) the class has started and the coach hasn't marked they've arrived.
 * (Running late is pushed by coach_mark_arrival itself.) Fires once per session.
 */
async function sweepFounderEscalations() {
  const now = Date.now();

  const { data: unconfirmed } = await supabase
    .from("class_sessions")
    .select("id,starts_at,coach_id,classes!inner(title)")
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .is("coach_confirmed_at", null)
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + 10 * 60000).toISOString())
    .limit(50);
  for (const s of unconfirmed ?? []) {
    await escalateToFounders(
      "ops_coach_unconfirmed",
      "Coach hasn't confirmed",
      s,
      (name, title, when) =>
        `${name} still hasn't confirmed they're coming to ${title} (${when}) — it starts in ~10 min. A nudge or a backup plan may be worth it.`
    );
  }

  // Bounded to the last hour so we never backfill old sessions.
  const { data: notArrived } = await supabase
    .from("class_sessions")
    .select("id,starts_at,coach_id,classes!inner(title)")
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .is("coach_arrived_at", null)
    .lte("starts_at", new Date(now).toISOString())
    .gt("starts_at", new Date(now - 60 * 60000).toISOString())
    .limit(50);
  for (const s of notArrived ?? []) {
    await escalateToFounders(
      "ops_coach_not_arrived",
      "Coach not marked arrived",
      s,
      (name, title, when) =>
        `${title} (${when}) has started but ${name} hasn't marked they've arrived. Worth a quick check-in.`
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

  for (const s of sessions ?? []) {
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
      await supabase.from("notifications").insert({
        user_id: candidate.client_id,
        type: "waitlist_spot",
        title: "A spot opened",
        body: `Claim it within ${claimMinutes} minutes.`,
        data: { session_id: sessionId, booking_id: candidate.id, url: "/app/book" },
      });
    }
  }
}

async function deliver(row: {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: { url?: string } & Record<string, unknown>;
}): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("email,full_name")
    .eq("id", row.user_id)
    .maybeSingle();
  const firstName = (profile?.full_name ?? "").trim().split(/\s+/)[0] || "there";

  // WhatsApp first for linked users. Inside the 24h service window we send rich
  // free-form text; outside it we fall back to the approved template (with the
  // member's name), and only then to email.
  if (await deliverWhatsApp(row, firstName)) return true;

  // Email fallback via Resend (web push needs VAPID keys — add them and a
  // push library here when keys are provisioned; email is the reliable path).
  if (!RESEND_KEY) return true; // nothing configured — count as delivered to avoid loops
  if (!profile?.email) return false;

  const deepLink = `${Deno.env.get("APP_URL") ?? "http://localhost:3000"}${row.data?.url ?? "/app"}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Sharwin TTA <notify@resend.dev>",
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
  return res.ok;
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
): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return false;

  const { data: link } = await supabase
    .from("wa_links")
    .select("phone")
    .eq("user_id", row.user_id)
    .maybeSingle();
  if (!link?.phone) return false;

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;

  // Interactive templates (WhatsApp-approved) can be sent business-initiated at
  // any time, so they don't depend on the 24h service window. When one is
  // configured for this notification type, send it and record the outbound SID
  // on the row so an inbound button tap can be mapped back to the session.
  const interactive = interactiveContentFor(row, firstName);
  if (interactive) {
    const sid = await twilioSend(endpoint, { To: `whatsapp:${link.phone}`, ...interactive });
    if (sid) {
      await supabase
        .from("notifications")
        .update({ data: { ...row.data, twilio_sid: sid } })
        .eq("id", row.id);
      return true;
    }
    // Interactive send failed (e.g. template not approved yet) → fall through to
    // the plain-text paths below so the coach still gets the message.
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
    fields.ContentSid = TWILIO_TEMPLATE_SID;
    fields.ContentVariables = JSON.stringify({ "1": firstName, "2": `${row.title} — ${row.body}` });
  } else {
    // No template configured and outside the window: can't send free-form.
    return false;
  }
  return (await twilioSend(endpoint, fields)) !== null;
}

/**
 * Maps a notification type to an interactive Content template + its variables,
 * or null when no interactive template applies (or its SID isn't configured).
 * Variable order must match the template body defined in
 * scripts/whatsapp/provision-templates.mjs.
 */
function interactiveContentFor(
  row: { type: string; data: Record<string, unknown> },
  firstName: string
): Record<string, string> | null {
  const d = row.data ?? {};
  if (row.type === "coach_before_class" && TWILIO_WA_COACH_REMINDER_SID) {
    return {
      ContentSid: TWILIO_WA_COACH_REMINDER_SID,
      ContentVariables: JSON.stringify({
        "1": firstName,
        "2": String(d.class_title ?? "your class"),
        "3": String(d.time_str ?? ""),
        "4": String(d.location_str ?? ""),
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
  return null;
}

/** POST to Twilio Messages; returns the message SID on success, else null. */
async function twilioSend(
  endpoint: string,
  fields: Record<string, string>
): Promise<string | null> {
  const auth = `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: TWILIO_FROM!, ...fields }),
  });
  if (!res.ok) {
    console.error("twilio send failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return null;
  }
  const json = (await res.json().catch(() => null)) as { sid?: string } | null;
  return json?.sid ?? "sent";
}
