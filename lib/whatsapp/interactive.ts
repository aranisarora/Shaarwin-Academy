// Deterministic handling of WhatsApp interactive replies (quick-reply buttons).
// A tap runs the SAME action the sender would get in the app — no LLM round-trip.
//
//   Coach   — coming check:   "Yes, I'm coming" / "Can't make it" (two-step)
//             arrival check:   "I've arrived" / "Running late"
//             after-class:    "All present" / "Some absent" (→ numbered reply)
//   Client  — reminder:       "I'll be there" / "Can't make it"
//             waitlist offer:  "Claim spot" / "Pass"
//   Founder — signup request:  "Approve" / "Deny" (new-user-approval-plan)
//
// The templates themselves are sent by the notify edge function
// (supabase/functions/notify) and provisioned by
// scripts/whatsapp/provision-templates.mjs. The button ids below MUST match the
// `id` fields in those template definitions.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { Profile } from "@/lib/auth";
import { formatClock } from "@/lib/academy-time";

export const WA_BUTTON = {
  COACH_CONFIRM: "coach_confirm",
  COACH_CANT: "coach_cant",
  COACH_ARRIVED: "coach_arrived",
  COACH_LATE: "coach_late",
  AC_PRESENT: "ac_present",
  AC_ABSENT: "ac_absent",
  REM_YES: "rem_yes",
  REM_NO: "rem_no",
  WL_CLAIM: "wl_claim",
  WL_PASS: "wl_pass",
  SU_APPROVE: "su_approve",
  SU_DENY: "su_deny",
} as const;

type ButtonId = (typeof WA_BUTTON)[keyof typeof WA_BUTTON];

const AFTER_GROUP: ReadonlySet<ButtonId> = new Set([WA_BUTTON.AC_PRESENT, WA_BUTTON.AC_ABSENT]);
const COACH_IDS: ReadonlySet<string> = new Set([
  WA_BUTTON.COACH_CONFIRM,
  WA_BUTTON.COACH_CANT,
  WA_BUTTON.COACH_ARRIVED,
  WA_BUTTON.COACH_LATE,
  WA_BUTTON.AC_PRESENT,
  WA_BUTTON.AC_ABSENT,
]);
const CLIENT_IDS: ReadonlySet<string> = new Set([
  WA_BUTTON.REM_YES,
  WA_BUTTON.REM_NO,
  WA_BUTTON.WL_CLAIM,
  WA_BUTTON.WL_PASS,
]);
const FOUNDER_IDS: ReadonlySet<string> = new Set([WA_BUTTON.SU_APPROVE, WA_BUTTON.SU_DENY]);

const FOUNDER_TITLE_TO_ID: Record<string, ButtonId> = {
  approve: WA_BUTTON.SU_APPROVE,
  deny: WA_BUTTON.SU_DENY,
};

// Exact matches: a known payload id, or the button's exact title typed out.
// Unambiguous — nobody types "all present ✅" in casual chat — so always honoured.
const COACH_TITLE_TO_ID: Record<string, ButtonId> = {
  "yes, i'm coming": WA_BUTTON.COACH_CONFIRM,
  "i'm coming": WA_BUTTON.COACH_CONFIRM,
  "im coming": WA_BUTTON.COACH_CONFIRM,
  "can't make it": WA_BUTTON.COACH_CANT,
  "cant make it": WA_BUTTON.COACH_CANT,
  "i've arrived": WA_BUTTON.COACH_ARRIVED,
  "ive arrived": WA_BUTTON.COACH_ARRIVED,
  "all present ✅": WA_BUTTON.AC_PRESENT,
  "all present": WA_BUTTON.AC_PRESENT,
  "some absent": WA_BUTTON.AC_ABSENT,
};

const CLIENT_TITLE_TO_ID: Record<string, ButtonId> = {
  "i'll be there": WA_BUTTON.REM_YES,
  "ill be there": WA_BUTTON.REM_YES,
  "can't make it": WA_BUTTON.REM_NO,
  "cant make it": WA_BUTTON.REM_NO,
  "claim spot": WA_BUTTON.WL_CLAIM,
  pass: WA_BUTTON.WL_PASS,
};

// Informal shorthands the coach reminder explicitly invites ("Reply 'coming',
// 'arrived', or 'running late'"). Coach-only, and honoured only when they line
// up with a real session (else → the agent). Clients get no loose matching.
const COACH_LOOSE_TO_ID: Record<string, ButtonId> = {
  coming: WA_BUTTON.COACH_CONFIRM,
  confirm: WA_BUTTON.COACH_CONFIRM,
  confirmed: WA_BUTTON.COACH_CONFIRM,
  "can't make it": WA_BUTTON.COACH_CANT,
  "cant make it": WA_BUTTON.COACH_CANT,
  arrived: WA_BUTTON.COACH_ARRIVED,
  reached: WA_BUTTON.COACH_ARRIVED,
  "running late": WA_BUTTON.COACH_LATE,
  late: WA_BUTTON.COACH_LATE,
  present: WA_BUTTON.AC_PRESENT,
  absent: WA_BUTTON.AC_ABSENT,
};

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://sharwinacademy.com";
}

/**
 * Handle an inbound interactive reply. Returns the text to send back, or null
 * when the input isn't a recognised deterministic action (so the caller falls
 * back to the assistant). Dispatches by role; coach and client paths never
 * cross.
 */
export async function handleInteractiveReply(opts: {
  admin: SupabaseClient<Database>;
  supabase: SupabaseClient<Database>;
  profile: Profile;
  payload: string;
  text: string;
  originalSid: string;
}): Promise<string | null> {
  if (opts.profile.role === "coach") return handleCoachReply(opts);
  if (opts.profile.role === "client") return handleClientReply(opts);
  if (opts.profile.role === "founder") return handleFounderReply(opts);
  return null;
}

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

async function handleCoachReply(opts: {
  admin: SupabaseClient<Database>;
  supabase: SupabaseClient<Database>;
  profile: Profile;
  payload: string;
  text: string;
  originalSid: string;
}): Promise<string | null> {
  const { admin, supabase, profile } = opts;

  // Numbered absent reply: a bare list of digits (e.g. "2 4", or "0" for none)
  // when this coach has a live "some absent" prompt. Checked before the class
  // actions so the digits aren't mistaken for anything else.
  if (/^\s*\d[\d\s,]*$/.test(opts.text)) {
    const done = await handleAbsentDigits(admin, supabase, profile, opts.text);
    if (done !== null) return done;
    // No live prompt → a bare number is probably ordinary chat; fall through.
  }

  // Live "can't make it" confirmation: a YES within 30 min commits the dropout;
  // anything else clears the prompt and falls through to normal handling.
  const cant = await handleCantConfirm(admin, supabase, profile, opts.text);
  if (cant !== null) return cant;

  const exact = resolveCoachExact(opts.payload, opts.text);
  const loose = exact ? null : resolveCoachLoose(opts.text);
  const action = exact ?? loose;
  if (!action) return null;

  const group = AFTER_GROUP.has(action) ? "after" : "before";
  const sessionId = await resolveSession(admin, supabase, profile.id, group, opts.originalSid);
  if (!sessionId) {
    if (loose && !opts.originalSid) return null;
    return "Thanks! I couldn't tell which session that was for though — which class did you mean? You can also update it in the app.";
  }

  const first = (profile.full_name ?? "").trim().split(/\s+/)[0] || "there";
  const sessionLink = `${appUrl()}/coach/session/${sessionId}`;

  switch (action) {
    case WA_BUTTON.COACH_CONFIRM: {
      const { error } = await supabase.rpc("coach_confirm_session", { p_session: sessionId });
      if (error) return errorReply(error.message);
      return `✅ Thanks ${first} — you're confirmed. See you there!`;
    }
    case WA_BUTTON.COACH_CANT: {
      // Destructive (triggers a cover search) → confirm in two steps. Arm the
      // prompt; a following YES commits it (handleCantConfirm).
      const armed = await armCantPrompt(admin, profile.id, sessionId);
      if (!armed) {
        return `To cancel, please do it in the app: ${sessionLink}`;
      }
      const { title, time } = await sessionTitleTime(supabase, sessionId);
      return `Are you sure you can't make ${title} at ${time}? Reply YES to confirm — we'll arrange cover.`;
    }
    case WA_BUTTON.COACH_ARRIVED: {
      const { error } = await supabase.rpc("coach_mark_arrival", {
        p_session: sessionId,
        p_late: false,
        p_source: "wa",
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
      return startAbsentPrompt(admin, supabase, profile.id, sessionId, sessionLink);
    }
  }
  return null;
}

// A tapped coach button id, or the button's exact title — a deliberate action.
function resolveCoachExact(payload: string, text: string): ButtonId | null {
  const p = (payload || "").trim();
  if (COACH_IDS.has(p)) return p as ButtonId;
  const t = (text || "").trim().toLowerCase();
  return COACH_TITLE_TO_ID[t] ?? null;
}

// A one-word coach status reply — matched on the whole message (not a substring)
// so "running late for the airport" doesn't count.
function resolveCoachLoose(text: string): ButtonId | null {
  const t = (text || "").trim().toLowerCase().replace(/[.!]+$/, "");
  return COACH_LOOSE_TO_ID[t] ?? null;
}

/**
 * "Some absent" → build the roster, store the ordered booking ids on the
 * after-class notification, and reply a numbered list. The coach then replies
 * with the numbers, handled by handleAbsentDigits. No extra template needed —
 * their tap opened a service window, so this follow-up is free-form.
 */
async function startAbsentPrompt(
  admin: SupabaseClient<Database>,
  supabase: SupabaseClient<Database>,
  coachId: string,
  sessionId: string,
  sessionLink: string
): Promise<string> {
  const roster = await sessionRoster(supabase, sessionId);
  if (!roster.length) {
    return `No booked students to mark. If that's not right, open the session: ${sessionLink}`;
  }

  const { data: note } = await admin
    .from("notifications")
    .select("id,data")
    .eq("user_id", coachId)
    .eq("type", "coach_after_class")
    .eq("data->>session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (note) {
    await admin
      .from("notifications")
      .update({
        data: {
          ...(note.data as Record<string, unknown>),
          absent_prompt: roster.map((r) => r.id),
          absent_prompt_at: new Date().toISOString(),
        },
      })
      .eq("id", note.id);
  }

  const list = roster.map((r, i) => `${i + 1} ${r.name}`).join(" · ");
  return (
    `Who was absent? Reply with the numbers (e.g. "2 4") — or 0 if everyone made it after all.\n${list}` +
    `\nOr tick them off in the app: ${sessionLink}`
  );
}

/**
 * A digits-only reply that follows a "some absent" prompt within 2 hours: mark
 * the named bookings no_show and the rest attended (the same statuses the app's
 * attendance UI writes), then clear the prompt. Returns null when there's no
 * live prompt (so the caller treats the number as ordinary chat).
 */
async function handleAbsentDigits(
  admin: SupabaseClient<Database>,
  supabase: SupabaseClient<Database>,
  profile: Profile,
  text: string
): Promise<string | null> {
  const { data: note } = await admin
    .from("notifications")
    .select("id,data")
    .eq("user_id", profile.id)
    .eq("type", "coach_after_class")
    .not("data->absent_prompt", "is", null)
    .gt("created_at", new Date(Date.now() - 6 * 3600000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!note) return null;

  const data = note.data as { absent_prompt?: string[]; absent_prompt_at?: string };
  const ids = data.absent_prompt ?? [];
  const at = data.absent_prompt_at ? new Date(data.absent_prompt_at).getTime() : 0;
  if (!ids.length || Date.now() - at > 2 * 3600000) return null;

  const nums = (text.match(/\d+/g) ?? []).map(Number);
  const absentIds = nums.includes(0)
    ? []
    : [...new Set(nums.filter((n) => n >= 1 && n <= ids.length).map((n) => ids[n - 1]))];
  const presentIds = ids.filter((id) => !absentIds.includes(id));

  if (absentIds.length) {
    await supabase
      .from("bookings")
      .update({ status: "no_show" })
      .in("id", absentIds)
      .eq("status", "confirmed");
  }
  if (presentIds.length) {
    await supabase
      .from("bookings")
      .update({ status: "attended" })
      .in("id", presentIds)
      .eq("status", "confirmed");
  }

  // Clear the prompt so a later stray number isn't misread.
  const cleared = { ...(note.data as Record<string, Json>) };
  delete cleared.absent_prompt;
  delete cleared.absent_prompt_at;
  await admin.from("notifications").update({ data: cleared }).eq("id", note.id);

  if (!absentIds.length) {
    return `Great — marked all ${presentIds.length} present ✅`;
  }
  const names = await bookingNames(supabase, absentIds);
  const absentPhrase = names.length ? names.join(", ") : `${absentIds.length}`;
  return `Marked ${absentPhrase} absent, ${presentIds.length} present ✅`;
}

/** Confirmed bookings for a session, ordered by player name. */
async function sessionRoster(
  supabase: SupabaseClient<Database>,
  sessionId: string
): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from("bookings")
    .select("id,players(full_name)")
    .eq("session_id", sessionId)
    .eq("status", "confirmed");
  return (data ?? [])
    .map((b) => ({
      id: b.id as string,
      name:
        ((b.players)?.full_name ?? "Player").trim() ||
        "Player",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Player names for a set of booking ids (for the confirmation reply). */
async function bookingNames(supabase: SupabaseClient<Database>, ids: string[]): Promise<string[]> {
  const { data } = await supabase.from("bookings").select("id,players(full_name)").in("id", ids);
  return (data ?? []).map(
    (b) =>
      ((b.players)?.full_name ?? "").trim().split(
        /\s+/
      )[0] || "Player"
  );
}

/**
 * Arm the two-step "can't make it" confirmation: stash cant_prompt + timestamp
 * on the coach's most recent notification for this session (whichever prompt
 * they replied to). Returns false when there's no row to anchor it on.
 */
async function armCantPrompt(
  admin: SupabaseClient<Database>,
  coachId: string,
  sessionId: string
): Promise<boolean> {
  const { data: note } = await admin
    .from("notifications")
    .select("id,data")
    .eq("user_id", coachId)
    .eq("data->>session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!note) return false;
  await admin
    .from("notifications")
    .update({
      data: {
        ...(note.data as Record<string, unknown>),
        cant_prompt: sessionId,
        cant_prompt_at: new Date().toISOString(),
      },
    })
    .eq("id", note.id);
  return true;
}

async function clearCantPrompt(
  admin: SupabaseClient<Database>,
  noteId: string,
  data: Record<string, Json>
): Promise<void> {
  const cleared = { ...data };
  delete cleared.cant_prompt;
  delete cleared.cant_prompt_at;
  await admin.from("notifications").update({ data: cleared }).eq("id", noteId);
}

/**
 * If the coach has a live "can't make it" prompt (armed within 30 min), a YES
 * commits handle_coach_dropout — the same RPC as the app's cantMakeIt. The
 * prompt is single-shot: cleared whatever the reply, so anything other than YES
 * clears it and returns null so normal handling continues. Returns null when
 * there's no live prompt at all.
 */
async function handleCantConfirm(
  admin: SupabaseClient<Database>,
  supabase: SupabaseClient<Database>,
  profile: Profile,
  text: string
): Promise<string | null> {
  const { data: note } = await admin
    .from("notifications")
    .select("id,data")
    .eq("user_id", profile.id)
    .not("data->cant_prompt", "is", null)
    .gt("created_at", new Date(Date.now() - 2 * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!note) return null;

  const data = note.data as { cant_prompt?: string; cant_prompt_at?: string };
  const sessionId = data.cant_prompt;
  const at = data.cant_prompt_at ? new Date(data.cant_prompt_at).getTime() : 0;

  // Single-shot: clear the prompt whatever the reply is.
  await clearCantPrompt(admin, note.id, note.data as Record<string, Json>);

  if (!sessionId || Date.now() - at > 30 * 60000) return null; // expired → fall through
  const t = (text || "").trim().toLowerCase().replace(/[.!]+$/, "");
  if (t !== "yes" && t !== "y") return null; // not a confirmation → fall through

  const { data: session } = await supabase
    .from("class_sessions")
    .select("starts_at,ends_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return "That session isn't on your schedule anymore.";

  const { error } = await supabase.rpc("handle_coach_dropout", {
    p_coach: profile.id,
    p_from: session.starts_at,
    p_to: session.ends_at,
  });
  if (error) return "Couldn't arrange cover just now — please tell the founder directly.";
  return "Thanks for letting us know — we're arranging cover so you're off this session.";
}

/** Class title + IST clock time for a session, for the cancel confirmation copy. */
async function sessionTitleTime(
  supabase: SupabaseClient<Database>,
  sessionId: string
): Promise<{ title: string; time: string }> {
  const { data } = await supabase
    .from("class_sessions")
    .select("starts_at,classes!inner(title)")
    .eq("id", sessionId)
    .maybeSingle();
  const c = data?.classes as { title?: string } | { title?: string }[] | null;
  const title = (Array.isArray(c) ? c[0]?.title : c?.title) ?? "your session";
  const time = data?.starts_at ? formatClock(data.starts_at) : "the session";
  return { title, time };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

async function handleClientReply(opts: {
  admin: SupabaseClient<Database>;
  supabase: SupabaseClient<Database>;
  profile: Profile;
  payload: string;
  text: string;
  originalSid: string;
}): Promise<string | null> {
  const { admin, supabase, profile } = opts;
  const action = resolveClientExact(opts.payload, opts.text, opts.originalSid);
  if (!action) return null; // typed free text → the assistant, as before

  // Client actions resolve context ONLY via the replied-to message's Twilio SID.
  const note = await noteBySid(admin, opts.originalSid, profile.id);

  if (action === WA_BUTTON.REM_YES) {
    return "See you there! 🏓";
  }

  if (action === WA_BUTTON.REM_NO) {
    const bookingId = note?.data?.booking_id as string | undefined;
    if (!bookingId) {
      return `No worries. Manage your bookings anytime here: ${appUrl()}/app/schedule`;
    }
    const { error } = await supabase.rpc("cancel_booking", { p_booking: bookingId });
    if (error) {
      if (error.message.includes("booking_not_live")) {
        return "That booking was already cancelled or changed — nothing more to do.";
      }
      return `Couldn't cancel that just now — please do it in the app: ${appUrl()}/app/schedule`;
    }
    return `Done — that spot's been freed up. Want to rebook another time? ${appUrl()}/app/schedule`;
  }

  if (action === WA_BUTTON.WL_CLAIM) {
    const bookingId = note?.data?.booking_id as string | undefined;
    if (!bookingId) {
      return `That offer has expired — see what's available on your schedule: ${appUrl()}/app/schedule`;
    }
    const { error } = await supabase.rpc("claim_waitlist_spot", { p_booking: bookingId });
    if (error) {
      if (error.message.includes("spot_gone")) {
        return "Ah — that spot was just taken. We'll let you know if another opens up.";
      }
      if (error.message.includes("session_not_bookable")) {
        return "That session's no longer open to book. Sorry about that!";
      }
      return `Couldn't claim it just now — try from your schedule: ${appUrl()}/app/schedule`;
    }
    if (note) await admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", note.id);
    return "🎉 You're in! The spot is yours — see it on your schedule.";
  }

  if (action === WA_BUTTON.WL_PASS) {
    if (note) {
      await admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", note.id);
    }
    return "No problem — we'll offer it to the next family.";
  }

  return null;
}

// Clients get NO loose-word matching: only a tapped payload id, or an exact
// button title paired with the replied-to message (so a stray "pass" in chat
// doesn't trigger anything).
function resolveClientExact(payload: string, text: string, originalSid: string): ButtonId | null {
  const p = (payload || "").trim();
  if (CLIENT_IDS.has(p)) return p as ButtonId;
  if (!originalSid) return null;
  const t = (text || "").trim().toLowerCase();
  const id = CLIENT_TITLE_TO_ID[t];
  return id && CLIENT_IDS.has(id) ? id : null;
}

/** The notification whose outbound Twilio SID matches, for this user, recent. */
async function noteBySid(
  admin: SupabaseClient<Database>,
  originalSid: string,
  userId: string
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  if (!originalSid) return null;
  const { data } = await admin
    .from("notifications")
    .select("id,data")
    .eq("data->>twilio_sid", originalSid)
    .eq("user_id", userId)
    .gt("created_at", new Date(Date.now() - 2 * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, data: (data.data ?? {}) as Record<string, unknown> } : null;
}

// ---------------------------------------------------------------------------
// Founder — closed-membership signup approvals
// ---------------------------------------------------------------------------

/**
 * Approve / Deny a signup request from the founder's WhatsApp. Context comes
 * ONLY from the replied-to message's Twilio SID → the signup_request
 * notification → its data.client_id (the applicant). review_signup_request is
 * the same RPC the admin app calls; the bot runs it on the founder's own minted
 * session, so auth.uid() = founder and the RPC's founder guard passes.
 */
async function handleFounderReply(opts: {
  admin: SupabaseClient<Database>;
  supabase: SupabaseClient<Database>;
  profile: Profile;
  payload: string;
  text: string;
  originalSid: string;
}): Promise<string | null> {
  const { admin, supabase } = opts;
  const action = resolveFounderExact(opts.payload, opts.text, opts.originalSid);
  if (!action) return null; // typed free text → the assistant

  const note = await noteBySidAnyUser(admin, opts.originalSid, "signup_request");
  const clientId = note?.data?.client_id as string | undefined;
  if (!clientId) {
    return `Couldn't tell which request that was for — review it in the app: ${appUrl()}/admin/players?view=clients`;
  }

  const applicant =
    (note?.data?.applicant_name as string | undefined)?.trim() || "the applicant";
  const approve = action === WA_BUTTON.SU_APPROVE;
  const { data, error } = await supabase.rpc("review_signup_request", {
    p_client: clientId,
    p_approve: approve,
  });
  if (error) {
    return `Couldn't update that just now — try from the app: ${appUrl()}/admin/players?view=clients`;
  }

  const result = (data ?? {}) as { ok?: boolean; error?: string };
  if (!result.ok) {
    if (result.error === "already_reviewed") return "Already handled.";
    return `Couldn't update that just now — try from the app: ${appUrl()}/admin/players?view=clients`;
  }
  return approve
    ? `Approved ✅ — ${applicant} has been sent the onboarding link.`
    : `Denied — they won't be notified.`;
}

// A tapped founder button id, or its exact title paired with the replied-to
// message (so a stray "approve" in chat never acts). No loose matching.
function resolveFounderExact(payload: string, text: string, originalSid: string): ButtonId | null {
  const p = (payload || "").trim();
  if (FOUNDER_IDS.has(p)) return p as ButtonId;
  if (!originalSid) return null;
  const t = (text || "").trim().toLowerCase();
  const id = FOUNDER_TITLE_TO_ID[t];
  return id && FOUNDER_IDS.has(id) ? id : null;
}

/** The notification whose outbound Twilio SID matches, of a given type, recent
 *  — not scoped to a user (the founder acts on the applicant's request row). */
async function noteBySidAnyUser(
  admin: SupabaseClient<Database>,
  originalSid: string,
  type: string
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  if (!originalSid) return null;
  const { data } = await admin
    .from("notifications")
    .select("id,data")
    .eq("data->>twilio_sid", originalSid)
    .eq("type", type)
    .gt("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, data: (data.data ?? {}) as Record<string, unknown> } : null;
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function errorReply(message: string): string {
  if (message.includes("not_your_session")) return "That session isn't on your schedule anymore.";
  if (message.includes("session_not_scheduled")) return "That session is no longer scheduled.";
  return "Sorry, that didn't go through — please try again in the app.";
}

/**
 * Which session does a coach tap refer to? First choice is exact: the outbound
 * interactive message recorded its Twilio SID on the source notification, and
 * WhatsApp echoes it back as OriginalRepliedMessageSid. Otherwise fall back to
 * the coach's nearest session for the button's phase (before/after class).
 */
async function resolveSession(
  admin: SupabaseClient<Database>,
  supabase: SupabaseClient<Database>,
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
