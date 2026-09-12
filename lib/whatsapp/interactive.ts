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
import { appBaseUrl } from "@/lib/app-url";

const WA_BUTTON = {
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
  COVER_CLAIM: "cover_claim",
} as const;

// Ways a coach says yes to a cover offer (K8). Loose matching is safe here in a
// way it isn't elsewhere, because the handler only acts when this coach has an
// OPEN cover offer — without one, "cover" is just a word and falls through to
// the assistant.
const COVER_WORDS = new Set([
  "claim",
  "claim it",
  // The literal title of the button on coach_cover_offer. A tap normally
  // arrives as the `cover_claim` payload, but the plain-text fallback of that
  // template invites the same words, and the one spelling the button itself
  // uses was the one spelling this set didn't have.
  "claim this session",
  "cover",
  "i'll cover",
  "ill cover",
  "i can cover",
  "i'll take it",
  "ill take it",
  "i'll take that",
  "take it",
]);

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
  // The other button on the same template. It was only in the LOOSE map, which
  // gave the two halves of one prompt different fallback rules: with no
  // resolvable session, "I've arrived" got "which class did you mean?" and
  // "Running late" fell silently through to the assistant.
  "running late": WA_BUTTON.COACH_LATE,
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

// Every link below is read on a coach's or parent's phone, so it has to be the
// public origin — see lib/app-url.ts for why `?? PRODUCTION` was not enough.
function appUrl(): string {
  return appBaseUrl();
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

/**
 * K8 — a coach taking an offered uncovered session. Returns the reply, or null
 * when this isn't a cover claim (so ordinary handling continues).
 *
 * Session resolution deliberately differs from every other coach action: the
 * session is read from the OFFER, because the coach doesn't own it yet. We
 * prefer the offer they actually replied to; failing that, their single open
 * offer. With several open we ask rather than guess — claiming the wrong
 * session commits them to being somewhere.
 */
async function handleCoverClaim(
  admin: SupabaseClient<Database>,
  supabase: SupabaseClient<Database>,
  profile: Profile,
  opts: { payload: string; text: string; originalSid: string }
): Promise<string | null> {
  const isClaim =
    opts.payload === WA_BUTTON.COVER_CLAIM ||
    COVER_WORDS.has(opts.text.trim().toLowerCase().replace(/[.!]+$/, ""));
  if (!isClaim) return null;

  let sessionId: string | null = null;

  if (opts.originalSid) {
    const { data } = await admin
      .from("notifications")
      .select("data")
      .eq("user_id", profile.id)
      .eq("type", "cover_offer")
      .eq("data->>twilio_sid", opts.originalSid)
      .limit(1)
      .maybeSingle();
    sessionId = ((data?.data ?? {}) as { session_id?: string }).session_id ?? null;
  }

  if (!sessionId) {
    const { data } = await admin
      .from("notifications")
      .select("data,created_at")
      .eq("user_id", profile.id)
      .eq("type", "cover_offer")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(3);
    const open = data ?? [];
    if (open.length === 1) {
      sessionId = ((open[0].data ?? {}) as { session_id?: string }).session_id ?? null;
    } else if (open.length > 1) {
      const list = open
        .map((o) => {
          const d = (o.data ?? {}) as { class_title?: string; time_str?: string };
          return `${d.class_title ?? "a session"} (${d.time_str ?? "?"})`;
        })
        .join(", ");
      return `You've got a few open right now — which one? ${list}`;
    }
  }

  // No open offer: they weren't asked to cover anything, so this is just chat.
  if (!sessionId) return null;

  const { error } = await supabase.rpc("claim_cover_session", { p_session: sessionId });
  if (error) {
    if (error.message.includes("already_taken")) {
      return "Ah — another coach got there first, so that one's covered. Thanks for offering!";
    }
    if (error.message.includes("session_started")) {
      return "That session has already started, so it's too late to pick it up.";
    }
    if (error.message.includes("session_not_available")) {
      return "That session isn't open for cover any more.";
    }
    if (error.message.includes("filter_failed")) {
      return "That one clashes with something on your schedule, so I can't assign it to you.";
    }
    return errorReply(error.message);
  }
  // "queued", never "told". These strings bypass the LLM entirely, so the
  // prompt rule against reporting a queue as a delivery cannot reach them —
  // the honesty has to be written into the literal.
  return "✅ It's yours — thanks for covering! You're marked as confirmed, and the families have been messaged.";
}

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

  // Cover claim (K8). Checked before the class actions because it resolves its
  // session from the OFFER, not from the coach's own schedule — they don't have
  // this session yet, which is the entire point.
  const cover = await handleCoverClaim(admin, supabase, profile, opts);
  if (cover !== null) return cover;

  const exact = resolveCoachExact(opts.payload, opts.text);
  const loose = exact ? null : resolveCoachLoose(opts.text);
  const action = exact ?? loose;
  if (!action) return null;

  const group = AFTER_GROUP.has(action) ? "after" : "before";
  const pick = await resolveSession(admin, supabase, profile.id, group, opts.originalSid);
  if (pick.kind === "ambiguous") {
    // Naming both is the whole point — "which one?" on its own asks the coach
    // to remember their own timetable while they are standing in a hall.
    const list = pick.options.map((o) => `${o.title} (${formatClock(o.at)})`).join(" or ");
    return `Happy to mark that — you've got two close together, so which one? ${list}`;
  }
  if (pick.kind === "none") {
    if (loose && !opts.originalSid) return null;
    return "Thanks! I couldn't tell which session that was for though — which class did you mean? You can also update it in the app.";
  }
  const sessionId = pick.id;

  const first = (profile.full_name ?? "").trim().split(/\s+/)[0] || "there";
  const sessionLink = `${appUrl()}/coach/session/${sessionId}`;
  // The same screen, told why the coach is arriving. `?wrap=1` means "finish
  // this class": if attendance is already in, the app opens straight into the
  // assessments that are left instead of showing a page of ticks the coach has
  // to read before finding the one thing still outstanding. Only the
  // after-class branches use it — a "to cancel, do it in the app" link is not
  // a wrap-up and must not behave like one.
  const wrapLink = `${sessionLink}?wrap=1`;

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
      // Queued, not delivered: a separate worker sends these later over
      // whichever channel each parent's settings allow, and some of them are
      // not reachable on WhatsApp at all. Saying "notified" promised the coach
      // something this code has no way to know.
      return "📍 Marked you as arrived — the parents have been messaged. Have a great session!";
    }
    case WA_BUTTON.COACH_LATE: {
      // p_source alongside p_late, the same way the arrived branch above sends
      // it. It only steers the parent-ping delay today (only 'auto' is held
      // back), but leaving it off meant this call claimed to be a screen tap.
      const { error } = await supabase.rpc("coach_mark_arrival", {
        p_session: sessionId,
        p_late: true,
        p_source: "wa",
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
      const next = await nextAssessmentLink(supabase, sessionId, wrapLink);
      return `✅ Marked ${who} present. ${next}`;
    }
    case WA_BUTTON.AC_ABSENT: {
      return startAbsentPrompt(admin, supabase, profile.id, sessionId, wrapLink);
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

  const data = note.data as {
    absent_prompt?: string[];
    absent_prompt_at?: string;
    session_id?: string;
  };
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

  // Attendance is only half the wrap-up, and this branch used to stop here —
  // a coach who did the whole roster over WhatsApp got a tick and nothing
  // else, while the "All present" branch beside it handed them the next
  // assessment. Same ending for both, so finishing one way or the other leads
  // to the same place.
  const sessionId = data.session_id;
  const wrapLink = sessionId
    ? `${appUrl()}/coach/session/${sessionId}?wrap=1`
    : `${appUrl()}/coach`;
  const next = sessionId
    ? ` ${await nextAssessmentLink(supabase, sessionId, wrapLink)}`
    : "";

  if (!absentIds.length) {
    return `Great — marked all ${presentIds.length} present ✅${next}`;
  }
  const names = await bookingNames(supabase, absentIds);
  const absentPhrase = names.length ? names.join(", ") : `${absentIds.length}`;
  return `Marked ${absentPhrase} absent, ${presentIds.length} present ✅${next}`;
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

/**
 * Where to send a coach once attendance is in. The assessment is the thing they
 * still have to do, so link the first player who needs one rather than the
 * session page they have just finished with — that page was the old link, and it
 * left the assessment a further two taps away.
 *
 * `get_pending_assessments` is the same 7-day backlog the in-app prompt uses, so
 * this can't offer an assessment that has already been filed. It only covers
 * sessions that have ENDED, so a coach tapping "All present" early gets the
 * session link back; that's the honest fallback rather than a dead deep link.
 */
async function nextAssessmentLink(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  sessionLink: string
): Promise<string> {
  const { data, error } = await supabase.rpc("get_pending_assessments");
  if (error || !data?.length) {
    return `Don't forget a quick assessment note for each: ${sessionLink}`;
  }
  // Prefer a player from the session just marked; otherwise the oldest pending.
  const rows = data as { player_id: string; player_name: string; session_id: string }[];
  const pick = rows.find((r) => r.session_id === sessionId) ?? rows[0];
  const first = (pick.player_name ?? "").trim().split(/\s+/)[0] || "your next player";
  const link = `${appUrl()}/coach/players/${pick.player_id}?session=${pick.session_id}`;
  const more = rows.length > 1 ? ` (${rows.length - 1} more after that)` : "";
  return `Next: rate ${first}${more} — ${link}`;
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

  // A live "are you sure?" from a previous Can't-make-it tap is checked before
  // anything else, because the YES that commits it is typed text and would
  // otherwise fall through to the assistant.
  const confirmed = await handleClientCancelConfirm(admin, supabase, profile, opts.text);
  if (confirmed !== null) return confirmed;

  const action = resolveClientExact(opts.payload, opts.text, opts.originalSid);
  if (!action) return null; // typed free text → the assistant, as before

  // Client actions resolve context ONLY via the replied-to message's Twilio SID.
  const note = await noteBySid(admin, opts.originalSid, profile.id);

  if (action === WA_BUTTON.REM_YES) {
    return "See you there! 🏓";
  }

  if (action === WA_BUTTON.REM_NO) {
    const bookingId = note?.data?.booking_id as string | undefined;
    if (!note || !bookingId) {
      return `No worries. Manage your bookings anytime here: ${appUrl()}/app/schedule`;
    }
    // Cancelling frees the seat irreversibly and can cost a credit, so it is
    // confirmed in two steps — the same guard the coach's "Can't make it" has
    // had since it started triggering a cover search. A mis-tap on a phone in a
    // pocket should not cost a family their session.
    const armed = await armClientCancelPrompt(admin, note.id, note.data, bookingId);
    if (!armed) {
      return `To cancel, please do it in the app: ${appUrl()}/app/schedule`;
    }
    const { title, time } = await bookingTitleTime(supabase, bookingId);
    return `Are you sure you can't make ${title} at ${time}? Reply YES to cancel — the spot goes to the next family.`;
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

/**
 * Arm the two-step cancel confirmation on the reminder the parent replied to.
 * Mirrors the coach's armCantPrompt, but keyed by booking rather than session —
 * a household can have two children in the same class, and only one booking is
 * being cancelled.
 */
async function armClientCancelPrompt(
  admin: SupabaseClient<Database>,
  noteId: string,
  data: Record<string, unknown>,
  bookingId: string
): Promise<boolean> {
  const { error } = await admin
    .from("notifications")
    .update({
      data: {
        ...(data as Record<string, Json>),
        cancel_prompt: bookingId,
        cancel_prompt_at: new Date().toISOString(),
      },
    })
    .eq("id", noteId);
  return !error;
}

/**
 * If the parent has a live cancel prompt (armed within 30 min), a YES commits
 * cancel_booking. Single-shot: the prompt is cleared whatever the reply, so
 * anything other than YES clears it and returns null so normal handling (and
 * then the assistant) continues. Returns null when there's no live prompt.
 *
 * Deliberately does NOT accept the button title "Can't make it" as a
 * confirmation — only a typed YES. Tapping the same button twice is exactly the
 * mis-tap this guard exists to catch.
 */
async function handleClientCancelConfirm(
  admin: SupabaseClient<Database>,
  supabase: SupabaseClient<Database>,
  profile: Profile,
  text: string
): Promise<string | null> {
  const { data: note } = await admin
    .from("notifications")
    .select("id,data")
    .eq("user_id", profile.id)
    .not("data->cancel_prompt", "is", null)
    .gt("created_at", new Date(Date.now() - 2 * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!note) return null;

  const data = note.data as { cancel_prompt?: string; cancel_prompt_at?: string };
  const bookingId = data.cancel_prompt;
  const at = data.cancel_prompt_at ? new Date(data.cancel_prompt_at).getTime() : 0;

  // Single-shot: clear the prompt whatever the reply is.
  const cleared = { ...(note.data as Record<string, Json>) };
  delete cleared.cancel_prompt;
  delete cleared.cancel_prompt_at;
  await admin.from("notifications").update({ data: cleared }).eq("id", note.id);

  if (!bookingId || Date.now() - at > 30 * 60000) return null; // expired → fall through
  const t = (text || "").trim().toLowerCase().replace(/[.!]+$/, "");
  if (t !== "yes" && t !== "y") return null; // not a confirmation → fall through

  const { error } = await supabase.rpc("cancel_booking", { p_booking: bookingId });
  if (error) {
    if (error.message.includes("booking_not_live")) {
      return "That booking was already cancelled or changed — nothing more to do.";
    }
    return `Couldn't cancel that just now — please do it in the app: ${appUrl()}/app/schedule`;
  }
  return `Done — that spot's been freed up. Want to rebook another time? ${appUrl()}/app/schedule`;
}

/** Class title + IST clock time for a booking, for the cancel confirmation copy. */
async function bookingTitleTime(
  supabase: SupabaseClient<Database>,
  bookingId: string
): Promise<{ title: string; time: string }> {
  const { data } = await supabase
    .from("bookings")
    .select("class_sessions!inner(starts_at,classes!inner(title))")
    .eq("id", bookingId)
    .maybeSingle();
  const s = data?.class_sessions as
    | { starts_at?: string; classes?: { title?: string } | { title?: string }[] }
    | null;
  const c = s?.classes;
  const title = (Array.isArray(c) ? c[0]?.title : c?.title) ?? "your session";
  const time = s?.starts_at ? formatClock(s.starts_at) : "the session";
  return { title, time };
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
  // Both from migration 0079. Say which it is — "that didn't go through" on a
  // cancelled class reads as a glitch and invites a retry that can't work.
  if (message.includes("session_cancelled")) return "That session was cancelled, so there's nothing to mark.";
  if (message.includes("outside_arrival_window")) {
    return "That's outside the window for marking arrival — if it's the wrong session, tell me which class you mean.";
  }
  return "Sorry, that didn't go through — please try again in the app.";
}

/**
 * How a coach's reply is matched to a session.
 *
 * `ambiguous` exists because guessing has a cost the coach pays: marking
 * arrival on the wrong session leaves the right one unmarked, so it escalates
 * to the founder while the coach believes they answered.
 */
type SessionPick =
  | { kind: "one"; id: string }
  | { kind: "ambiguous"; options: { id: string; title: string; at: string }[] }
  | { kind: "none" };

/** Two candidates this close in |distance from now| are a coin toss, not a pick. */
const TIE_MS = 15 * 60000;

/**
 * Which session does a coach tap refer to? First choice is exact: the outbound
 * interactive message recorded its Twilio SID on the source notification, and
 * WhatsApp echoes it back as OriginalRepliedMessageSid. Otherwise fall back to
 * the coach's nearest session for the button's phase (before/after class).
 *
 * The fallback runs whenever the SID is missing — which is every time a coach
 * TYPES "arrived" rather than swipe-replying, so it is the common path and not
 * the rare one. It used to take the nearest session unconditionally, breaking
 * exact ties toward the earlier one on a strict `<`. Back-to-back sessions an
 * hour apart are routine here (Keerthana and Sunil Hatti have such pairs on
 * most days), and halfway between two of them the "nearest" is arbitrary from
 * the coach's point of view. So when the top two are within TIE_MS of each
 * other we ask, the same way handleCoverClaim already asks rather than commit
 * a coach to being somewhere.
 *
 * Push is immune to all of this — every banner carries its own session_id — so
 * this only has to hold the line for WhatsApp.
 */
async function resolveSession(
  admin: SupabaseClient<Database>,
  supabase: SupabaseClient<Database>,
  coachId: string,
  group: "before" | "after",
  originalSid: string
): Promise<SessionPick> {
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
    if (sid) return { kind: "one", id: sid };
  }

  if (group === "before") {
    const { data } = await supabase
      .from("class_sessions")
      .select("id,starts_at,classes!inner(title)")
      .eq("coach_id", coachId)
      .eq("status", "scheduled")
      .gte("starts_at", new Date(Date.now() - 45 * 60000).toISOString())
      .lte("starts_at", new Date(Date.now() + 120 * 60000).toISOString())
      .order("starts_at", { ascending: true });

    const now = Date.now();
    const ranked = (data ?? [])
      .map((r) => {
        const c = r.classes as { title?: string } | { title?: string }[] | null;
        return {
          id: r.id as string,
          at: r.starts_at as string,
          title: (Array.isArray(c) ? c[0]?.title : c?.title) ?? "your session",
          diff: Math.abs(new Date(r.starts_at as string).getTime() - now),
        };
      })
      .sort((a, b) => a.diff - b.diff);

    if (!ranked.length) return { kind: "none" };
    if (ranked.length > 1 && ranked[1].diff - ranked[0].diff <= TIE_MS) {
      return { kind: "ambiguous", options: ranked.slice(0, 3) };
    }
    return { kind: "one", id: ranked[0].id };
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
  return data?.[0]?.id ? { kind: "one", id: data[0].id as string } : { kind: "none" };
}
