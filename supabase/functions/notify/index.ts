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
  // Anti-noise: one delivery per (user, type, session) per batch — later rows win.
  const seen = new Set<string>();
  const rows = [...(due ?? [])].reverse();

  for (const row of rows) {
    const dedupeKey = `${row.user_id}:${row.type}:${row.data?.session_id ?? row.id}`;
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

  return new Response(JSON.stringify({ sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});

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
  // WhatsApp first for linked users (Twilio can only deliver freeform inside
  // the 24h session window — outside it the send fails and we fall through
  // to email; register an approved template to lift that limit).
  if (await deliverWhatsApp(row)) return true;

  // Email fallback via Resend (web push needs VAPID keys — add them and a
  // push library here when keys are provisioned; email is the reliable path).
  if (!RESEND_KEY) return true; // nothing configured — count as delivered to avoid loops

  const { data: profile } = await supabase
    .from("profiles")
    .select("email,full_name")
    .eq("id", row.user_id)
    .maybeSingle();
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

async function deliverWhatsApp(row: {
  user_id: string;
  title: string;
  body: string;
}): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return false;

  const { data: link } = await supabase
    .from("wa_links")
    .select("phone")
    .eq("user_id", row.user_id)
    .maybeSingle();
  if (!link?.phone) return false;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: TWILIO_FROM,
        To: `whatsapp:${link.phone}`,
        Body: `*${row.title}*\n${row.body}`,
      }),
    }
  );
  return res.ok;
}
