// Deterministic handling of WhatsApp interactive replies (quick-reply buttons).
// A coach tapping "I'm coming" / "I've arrived" / "Running late" on the
// before-class reminder, or "All present" / "Some absent" on the after-class
// summary, runs the SAME action they'd get in the app — no LLM round-trip.
//
// The interactive templates themselves are sent by the notify edge function
// (supabase/functions/notify) and provisioned by
// scripts/whatsapp/provision-templates.mjs. The button ids below MUST match the
// `id` fields in those template definitions.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/auth";

export const WA_BUTTON = {
  COACH_CONFIRM: "coach_confirm",
  COACH_ARRIVED: "coach_arrived",
  COACH_LATE: "coach_late",
  AC_PRESENT: "ac_present",
  AC_ABSENT: "ac_absent",
} as const;

type ButtonId = (typeof WA_BUTTON)[keyof typeof WA_BUTTON];

const AFTER_GROUP: ReadonlySet<ButtonId> = new Set([WA_BUTTON.AC_PRESENT, WA_BUTTON.AC_ABSENT]);
const KNOWN_IDS: ReadonlySet<string> = new Set(Object.values(WA_BUTTON));

// Exact matches: a known payload id, or the button's exact title typed out.
// Unambiguous — nobody types "all present ✅" in casual chat — so always honoured.
const EXACT_TITLE_TO_ID: Record<string, ButtonId> = {
  "i'm coming": WA_BUTTON.COACH_CONFIRM,
  "im coming": WA_BUTTON.COACH_CONFIRM,
  "i've arrived": WA_BUTTON.COACH_ARRIVED,
  "ive arrived": WA_BUTTON.COACH_ARRIVED,
  "all present ✅": WA_BUTTON.AC_PRESENT,
  "all present": WA_BUTTON.AC_PRESENT,
  "some absent": WA_BUTTON.AC_ABSENT,
};

// Informal shorthands the reminder explicitly invites ("Reply 'coming',
// 'arrived', or 'running late'"). These double as ordinary words, so the caller
// only honours them when they line up with a real session (else → the agent).
const LOOSE_WORD_TO_ID: Record<string, ButtonId> = {
  coming: WA_BUTTON.COACH_CONFIRM,
  confirm: WA_BUTTON.COACH_CONFIRM,
  confirmed: WA_BUTTON.COACH_CONFIRM,
  arrived: WA_BUTTON.COACH_ARRIVED,
  reached: WA_BUTTON.COACH_ARRIVED,
  "running late": WA_BUTTON.COACH_LATE,
  late: WA_BUTTON.COACH_LATE,
  present: WA_BUTTON.AC_PRESENT,
  absent: WA_BUTTON.AC_ABSENT,
};

// A tapped button id, or the button's exact title — always a deliberate action.
function resolveExact(payload: string, text: string): ButtonId | null {
  const p = (payload || "").trim();
  if (KNOWN_IDS.has(p)) return p as ButtonId;
  const t = (text || "").trim().toLowerCase();
  return EXACT_TITLE_TO_ID[t] ?? null;
}

// A one-word status reply. Matched on the whole message (not a substring) so
// "running late for the airport" doesn't count — only a bare "running late".
function resolveLoose(text: string): ButtonId | null {
  const t = (text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return LOOSE_WORD_TO_ID[t] ?? null;
}

/**
 * Handle an inbound interactive reply. Returns the text to send back, or null
 * when the input isn't a recognised coach action (so the caller can fall back
 * to the normal assistant).
 */
export async function handleInteractiveReply(opts: {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  profile: Profile;
  payload: string;
  text: string;
  originalSid: string;
}): Promise<string | null> {
  const { admin, supabase, profile } = opts;
  // Only coaches ever act on these prompts; anyone else falls through.
  if (profile.role !== "coach") return null;

  // Exact taps/titles are honoured outright; a loose one-word reply only when it
  // resolves to a real session (checked below).
  const exact = resolveExact(opts.payload, opts.text);
  const loose = exact ? null : resolveLoose(opts.text);
  const action = exact ?? loose;
  if (!action) return null;

  const group = AFTER_GROUP.has(action) ? "after" : "before";
  const sessionId = await resolveSession(admin, supabase, profile.id, group, opts.originalSid);
  if (!sessionId) {
    // A tap / exact phrase is unmistakably an action → help them place it. A
    // bare word matching no live session is likely just conversation, so hand
    // it back to the assistant (null) rather than nag about "which class?".
    if (loose && !opts.originalSid) return null;
    return "Thanks! I couldn't tell which session that was for though — which class did you mean? You can also update it in the app.";
  }

  const first = (profile.full_name ?? "").trim().split(/\s+/)[0] || "there";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://sharwinacademy.com";
  const sessionLink = `${appUrl}/coach/session/${sessionId}`;

  switch (action) {
    case WA_BUTTON.COACH_CONFIRM: {
      const { error } = await supabase.rpc("coach_confirm_session", { p_session: sessionId });
      if (error) return errorReply(error.message);
      return `✅ Thanks ${first} — you're confirmed. See you there!`;
    }
    case WA_BUTTON.COACH_ARRIVED: {
      const { error } = await supabase.rpc("coach_mark_arrival", {
        p_session: sessionId,
        p_late: false,
      });
      if (error) return errorReply(error.message);
      return "📍 Marked you as arrived — the parents have been notified. Have a great session!";
    }
    case WA_BUTTON.COACH_LATE: {
      const { error } = await supabase.rpc("coach_mark_arrival", {
        p_session: sessionId,
        p_late: true,
      });
      if (error) return errorReply(error.message);
      return "🏃 Thanks for the heads-up — we've let everyone know you're running a little late.";
    }
    case WA_BUTTON.AC_PRESENT: {
      const { data, error } = await supabase
        .from("bookings")
        .update({ status: "attended" })
        .eq("session_id", sessionId)
        .eq("status", "confirmed")
        .select("id");
      if (error) return "Couldn't save attendance just now — please mark it in the app.";
      const n = data?.length ?? 0;
      const who = n === 0 ? "everyone" : n === 1 ? "the student" : `all ${n} students`;
      return `✅ Marked ${who} present. Don't forget to add a quick assessment note for each: ${sessionLink}`;
    }
    case WA_BUTTON.AC_ABSENT: {
      return `No problem — open the session to tick exactly who was present or absent: ${sessionLink}\nOr just reply with the name, e.g. "Aryan was absent".`;
    }
  }
  return null;
}

function errorReply(message: string): string {
  if (message.includes("not_your_session")) return "That session isn't on your schedule anymore.";
  if (message.includes("session_not_scheduled")) return "That session is no longer scheduled.";
  return "Sorry, that didn't go through — please try again in the app.";
}

/**
 * Which session does this tap refer to? First choice is exact: the outbound
 * interactive message recorded its Twilio SID on the source notification, and
 * WhatsApp echoes it back as OriginalRepliedMessageSid. Otherwise fall back to
 * the coach's nearest session for the button's phase (before/after class).
 */
async function resolveSession(
  admin: SupabaseClient,
  supabase: SupabaseClient,
  coachId: string,
  group: "before" | "after",
  originalSid: string
): Promise<string | null> {
  if (originalSid) {
    const { data } = await admin
      .from("notifications")
      .select("data")
      .eq("data->>twilio_sid", originalSid)
      .gt("created_at", new Date(Date.now() - 2 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sid = (data?.data as { session_id?: string } | undefined)?.session_id;
    if (sid) return sid;
  }

  if (group === "before") {
    const { data } = await supabase
      .from("class_sessions")
      .select("id,starts_at")
      .eq("coach_id", coachId)
      .eq("status", "scheduled")
      .gte("starts_at", new Date(Date.now() - 45 * 60000).toISOString())
      .lte("starts_at", new Date(Date.now() + 120 * 60000).toISOString())
      .order("starts_at", { ascending: true });
    return closestToNow((data ?? []).map((r) => ({ id: r.id, at: r.starts_at })));
  }

  const { data } = await supabase
    .from("class_sessions")
    .select("id,ends_at")
    .eq("coach_id", coachId)
    .in("status", ["scheduled", "completed"])
    .gte("ends_at", new Date(Date.now() - 6 * 3600000).toISOString())
    .lte("ends_at", new Date(Date.now() + 30 * 60000).toISOString())
    .order("ends_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}

function closestToNow(rows: { id: string; at: string }[]): string | null {
  if (!rows.length) return null;
  const now = Date.now();
  let best = rows[0];
  let bestDiff = Infinity;
  for (const r of rows) {
    const diff = Math.abs(new Date(r.at).getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best.id;
}
