// Notification preferences — three grouped toggles, not one per message type.
// (notification-fix-plan 2.6 / gap G9.)
//
// The old list was five per-type switches, which had two problems: it only
// covered five of the ~30 types we actually send (so most messages were
// unmutable by accident rather than by decision), and it asked members to
// reason about our internal type names. Grouping states the real choice —
// "do you want reminders / progress / news" — and, crucially, gives every
// future message type a home: adding one means assigning it a group, not
// leaving it silently unmutable.
//
// What stays UNMUTABLE is now a deliberate, short list: safety (a cancelled
// session, a coach running late, an absence) and money at risk (a failed
// payment). Everything else a member can turn off.

export type PrefGroup = "reminders" | "progress" | "news";

export const PREF_GROUPS: {
  key: PrefGroup;
  label: string;
  description: string;
}[] = [
  {
    key: "reminders",
    label: "Reminders",
    description: "Session reminders, waitlist spots, and schedule or coach changes.",
  },
  {
    key: "progress",
    label: "Progress",
    description: "Monthly summaries, assessments and coach notes about your player.",
  },
  {
    key: "news",
    label: "News & offers",
    description: "New classes, camps, renewal notices and academy announcements.",
  },
];

export type Audience = "parent" | "coach" | "founder" | "both";

export type NotificationRule = {
  who: Audience;
  /** WhatsApp always + push additive. False means push may end the chain. */
  answer: boolean;
  /** The toggle that silences it, or false if none does. */
  mute: PrefGroup | false;
  /** Held to 08:00 IST when it comes due inside quiet hours. */
  defer: boolean;
  /** Overrides preferences and a STOP. Account- and safety-critical only. */
  critical?: true;
  /** Never delivered; rendered in the in-app feed only. */
  feedOnly?: true;
};

/**
 * Every notification type, and what happens to it. One row each.
 *
 * This is a MIRROR of `TYPES` in supabase/functions/notify/index.ts, which is
 * the copy that actually routes messages. The worker is Deno and cannot import
 * from lib/, so the table is duplicated across the boundary on purpose — the
 * same arrangement as the WhatsApp button ids in lib/whatsapp/interactive.ts.
 *
 * notification-prefs.test.ts reads the worker's source and compares the two
 * tables entry by entry, because a drift here is invisible from the app side:
 * a member turns a toggle off and the messages keep coming, which is the exact
 * failure the toggle exists to prevent.
 *
 * The columns are documented at length above the worker's copy. In short:
 * `answer` true means WhatsApp always with push on top, false means push if
 * they have a fresh subscription and WhatsApp if they don't; `mute` names the
 * toggle that silences it; `critical` overrides prefs and a STOP; `defer`
 * holds it to 08:00 IST out of quiet hours; `feedOnly` never delivers at all.
 *
 * Email is absent by design. It is OTP and auth only — not a channel here, and
 * not a fallback.
 */
export const NOTIFICATION_TYPES: Record<string, NotificationRule> = {
  // ── Parent: the session is happening, or it isn't ─────────────────────────
  reminder_upcoming: { who: "parent", answer: true, mute: "reminders", defer: false },
  coach_arrived: { who: "parent", answer: true, mute: "reminders", defer: false },
  coach_late: { who: "parent", answer: true, mute: false, defer: false },
  waitlist_spot: { who: "parent", answer: true, mute: "reminders", defer: false },
  session_cancelled: { who: "parent", answer: true, mute: false, defer: false, critical: true },
  player_absent: { who: "parent", answer: true, mute: false, defer: false, critical: true },
  session_outcome: { who: "parent", answer: true, mute: "progress", defer: false },

  // Schedule changes to a parent — WhatsApp always, because a missed one means
  // turning up at the wrong time or not at all.
  coach_changed: { who: "parent", answer: true, mute: "reminders", defer: true },
  session_moved: { who: "both", answer: true, mute: "reminders", defer: false },
  private_session_booked: { who: "parent", answer: true, mute: "reminders", defer: true },

  // ── Parent: money ─────────────────────────────────────────────────────────
  payment_failed: { who: "parent", answer: true, mute: false, defer: true, critical: true },
  payment_receipt: { who: "parent", answer: false, mute: "news", defer: true },
  renewal_upcoming: { who: "parent", answer: false, mute: "news", defer: true },

  // ── Parent: account ───────────────────────────────────────────────────────
  signup_approved: { who: "parent", answer: true, mute: false, defer: true, critical: true },

  // ── Parent: the informational tail ────────────────────────────────────────
  booking_confirmed: { who: "parent", answer: false, mute: "reminders", defer: true },
  booking_rescheduled: { who: "parent", answer: false, mute: "reminders", defer: true },
  coach_assigned: { who: "parent", answer: false, mute: "reminders", defer: true },
  class_updated: { who: "parent", answer: false, mute: "reminders", defer: false },
  session_booked: { who: "parent", answer: false, mute: "reminders", defer: false },
  private_series_ended: { who: "parent", answer: false, mute: false, defer: true },
  private_minutes_low: { who: "parent", answer: false, mute: false, defer: true },
  assessment_ready: { who: "parent", answer: false, mute: "progress", defer: true },
  student_note: { who: "parent", answer: false, mute: "progress", defer: true },
  monthly_progress: { who: "parent", answer: false, mute: "progress", defer: true },
  new_class_open: { who: "parent", answer: false, mute: "news", defer: true },
  announcement: { who: "both", answer: false, mute: "news", defer: false },

  // ── Coach: running their own class ────────────────────────────────────────
  coach_before_class: { who: "coach", answer: true, mute: false, defer: false },
  coach_confirm_nudge_2: { who: "coach", answer: true, mute: false, defer: false },
  coach_arrival_check: { who: "coach", answer: true, mute: false, defer: false },
  coach_after_class: { who: "coach", answer: true, mute: false, defer: false },
  new_private_session: { who: "coach", answer: true, mute: false, defer: false },
  session_unassigned: { who: "coach", answer: true, mute: false, defer: false },
  cover_offer: { who: "coach", answer: true, mute: false, defer: false },
  coach_day_ahead: { who: "coach", answer: true, mute: false, defer: false },
  role_changed: { who: "coach", answer: false, mute: false, defer: true },

  // ── Founder: act now ──────────────────────────────────────────────────────
  ops_coach_unconfirmed: { who: "founder", answer: true, mute: false, defer: false },
  ops_coach_not_arrived: { who: "founder", answer: true, mute: false, defer: false },
  signup_request: { who: "founder", answer: true, mute: false, defer: false, critical: true },
  founder_morning_brief: { who: "founder", answer: true, mute: false, defer: false },
  ops_daily_digest: { who: "founder", answer: true, mute: false, defer: true },
  ops_unreachable: { who: "founder", answer: true, mute: false, defer: false },
  private_request_parked: { who: "founder", answer: false, mute: false, defer: false },
  ops_private_series_paused: { who: "founder", answer: false, mute: false, defer: false },
  ops_payment_issue: { who: "founder", answer: false, mute: false, defer: false },

  // ── Founder: the /admin feed, never delivered ─────────────────────────────
  ops_booking: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_cancellation: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_attendance: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_payment: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_membership: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_new_client: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_new_coach: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_player_added: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_credit_used: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_coach_change: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_cover_claimed: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },
  ops_session_coach_invalid: { who: "founder", answer: false, mute: false, defer: false, feedOnly: true },

  // ── No producer today ─────────────────────────────────────────────────────
  // Kept rather than deleted; each was superseded, not removed. The worker's
  // copy records what replaced each one.
  reminder_24h: { who: "parent", answer: false, mute: "reminders", defer: false },
  reminder_2h: { who: "parent", answer: false, mute: "reminders", defer: false },
  confirm_session_nudge: { who: "coach", answer: false, mute: false, defer: false },
  ops_coach_confirmed: { who: "founder", answer: false, mute: false, defer: false },
  ops_wa_linked: { who: "founder", answer: false, mute: false, defer: false },
};

/**
 * Which toggle governs which notification type — derived from the table above
 * so the two can never disagree.
 *
 * A type that appears in neither this map nor the worker's is treated as
 * unmutable, so omissions fail loud (a message that keeps arriving) rather than
 * silent (a message nobody ever receives).
 */
export const PREF_GROUP_FOR_TYPE: Record<string, PrefGroup> = Object.fromEntries(
  Object.entries(NOTIFICATION_TYPES)
    .filter(([, rule]) => rule.mute !== false)
    .map(([type, rule]) => [type, rule.mute as PrefGroup])
);

/**
 * Types no toggle can silence, and why. Kept as data so the reason is
 * reviewable rather than implied by absence from the map above.
 *
 * This is the member-facing subset — the ones a parent might otherwise expect
 * to find a switch for. Plenty of coach and founder types are unmutable too;
 * they simply never appear on a member's settings screen.
 */
export const UNMUTABLE: [string, string][] = [
  ["session_cancelled", "the session isn't happening"],
  ["coach_late", "your coach isn't there yet"],
  ["player_absent", "your player wasn't at the session"],
  ["payment_failed", "your membership is about to lapse"],
  ["signup_request", "someone is waiting on you to act"],
  ["signup_approved", "you're waiting on us to act"],
];

/**
 * Legacy per-type keys written by the old profile editor. Still honoured when
 * reading (an existing member's stored `false` keeps working), never written.
 */
export const LEGACY_PREF_TYPES: [string, string][] = [
  ["reminder_upcoming", "Session reminders"],
  ["waitlist_spot", "Waitlist openings"],
  ["coach_changed", "Coach changes"],
  ["booking_rescheduled", "Reschedule confirmations"],
  ["renewal_upcoming", "Renewal notices"],
];

/** Every pref key a STOP should switch off (and START back on). */
export const ALL_PREF_KEYS: string[] = [
  ...PREF_GROUPS.map((g) => g.key),
  ...LEGACY_PREF_TYPES.map(([k]) => k),
];

/**
 * Is this notification type muted for the given stored preferences?
 * Per-type keys win over the group toggle, so a member who explicitly turned
 * one thing off before the regrouping keeps that choice.
 */
export function isMuted(
  type: string,
  prefs: Record<string, boolean> | null | undefined
): boolean {
  if (!prefs) return false;
  if (prefs[type] === false) return true;
  const group = PREF_GROUP_FOR_TYPE[type];
  return group ? prefs[group] === false : false;
}
