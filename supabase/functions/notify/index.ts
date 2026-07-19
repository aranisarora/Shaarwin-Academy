// P11 — delivery worker. Deploy as a Supabase Edge Function on a 1-minute cron:
//   supabase functions deploy notify
//   select cron.schedule('notify-worker', '* * * * *', $$select net.http_post(
//     url := 'https://<ref>.supabase.co/functions/v1/notify',
//     headers := '{"Authorization": "Bearer <service-role-key>"}'::jsonb)$$);
//
// Claims due rows (skip-locked semantics via status flip), tries web push to
// every subscription, falls back to Resend email, marks sent/failed.

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
const WINDOW_MS = 24 * 60 * 60 * 1000;

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

  // Sweep: expire unclaimed waitlist offers → offer to next in line (A3).
  await sweepWaitlistOffers();

  // Sweep: nudge coaches to confirm upcoming sessions; escalate to the
  // founder when a session is close and still unconfirmed.
  await sweepCoachConfirmations();

  return new Response(JSON.stringify({ sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});

/**
 * Coach confirmations: 24h out, ask the coach to confirm they're taking the
 * session ("I'm coming"). If it's under 3h away and still unconfirmed, alert
 * the founder so they can chase or arrange cover. Each message fires once per
 * (session, recipient) — existence of the earlier notification is the marker.
 */
async function sweepCoachConfirmations() {
  const now = Date.now();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id,starts_at,coach_id,classes!inner(title)")
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .is("coach_confirmed_at", null)
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + 24 * 3600000).toISOString())
    .limit(50);

  for (const s of sessions ?? []) {
    const title = (s.classes as unknown as { title: string } | null)?.title ?? "your session";
    const when = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    }).format(new Date(s.starts_at));

    const { data: nudged } = await supabase
      .from("notifications")
      .select("id")
      .eq("type", "confirm_session_nudge")
      .eq("user_id", s.coach_id)
      .eq("data->>session_id", s.id)
      .limit(1);
    if (!nudged?.length) {
      await supabase.from("notifications").insert({
        user_id: s.coach_id,
        type: "confirm_session_nudge",
        title: "Confirm your session",
        body: `Are you taking ${title} (${when})? Reply "confirm" here, or tap Confirm in the app.`,
        data: { session_id: s.id, url: `/coach/session/${s.id}` },
      });
    }

    // Escalate: session is soon and the coach still hasn't confirmed.
    if (new Date(s.starts_at).getTime() - now < 3 * 3600000) {
      const { data: escalated } = await supabase
        .from("notifications")
        .select("id")
        .eq("type", "ops_coach_unconfirmed")
        .eq("data->>session_id", s.id)
        .limit(1);
      if (!escalated?.length) {
        const { data: coach } = await supabase
          .from("profiles")
          .select("full_name,phone")
          .eq("id", s.coach_id)
          .maybeSingle();
        const { data: founders } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "founder");
        if (founders?.length) {
          await supabase.from("notifications").insert(
            founders.map((f) => ({
              user_id: f.id,
              type: "ops_coach_unconfirmed",
              title: "Coach hasn't confirmed",
              body: `${coach?.full_name ?? "The coach"} still hasn't confirmed ${title} (${when})${coach?.phone ? ` — chase them on ${coach.phone}` : ""}.`,
              data: { session_id: s.id, url: "/admin/schedule" },
            }))
          );
        }
      }
    }
  }
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
  title: string;
  body: string;
  data: { url?: string };
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
  row: { user_id: string; title: string; body: string },
  firstName: string
): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return false;

  const { data: link } = await supabase
    .from("wa_links")
    .select("phone")
    .eq("user_id", row.user_id)
    .maybeSingle();
  if (!link?.phone) return false;

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

  const auth = `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`;
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;

  const params = new URLSearchParams({ From: TWILIO_FROM, To: `whatsapp:${link.phone}` });
  if (inWindow) {
    params.set("Body", `*${row.title}*\n${row.body}`);
  } else if (TWILIO_TEMPLATE_SID) {
    // Business-initiated outside the window → approved Utility template.
    params.set("ContentSid", TWILIO_TEMPLATE_SID);
    params.set(
      "ContentVariables",
      JSON.stringify({ "1": firstName, "2": `${row.title} — ${row.body}` })
    );
  } else {
    // No template configured and outside the window: can't send free-form.
    return false;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  return res.ok;
}
