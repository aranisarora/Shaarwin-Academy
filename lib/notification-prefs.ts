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

/**
 * Which toggle governs which notification type.
 *
 * MUST stay in sync with PREF_GROUP_FOR_TYPE in
 * supabase/functions/notify/index.ts — the worker is Deno and can't import from
 * lib/, so the map is duplicated there deliberately (same arrangement as the
 * WhatsApp button ids in lib/whatsapp/interactive.ts).
 *
 * A type that appears in neither this map nor the worker's is treated as
 * unmutable, so omissions fail loud (a message that keeps arriving) rather than
 * silent (a message nobody ever receives).
 */
export const PREF_GROUP_FOR_TYPE: Record<string, PrefGroup> = {
  // ── Reminders ──
  reminder_upcoming: "reminders",
  waitlist_spot: "reminders",
  coach_changed: "reminders",
  booking_rescheduled: "reminders",
  booking_confirmed: "reminders",
  session_moved: "reminders",
  class_updated: "reminders",
  coach_assigned: "reminders",
  private_session_booked: "reminders",
  // Reassurance decays with repetition: the tenth "your coach has arrived" is
  // noise, so it's mutable — while coach_late stays unmutable, because a coach
  // NOT being there is the thing a parent actually needs to know. (Plan 2.6 /
  // the C10 exceptions-first amendment.)
  coach_arrived: "reminders",

  // ── Progress ──
  // The positive session outcome. Its counterpart player_absent is deliberately
  // absent from this map — see UNMUTABLE.
  session_outcome: "progress",
  monthly_progress: "progress",
  assessment_ready: "progress",
  student_note: "progress",

  // ── News & offers ──
  announcement: "news",
  renewal_upcoming: "news",
  new_class_open: "news",
  // Receipts are a record, not an alert — mutable for anyone who'd rather read
  // them in the app. The FAILED payment stays unmutable (money at risk).
  payment_receipt: "news",
};

/**
 * Types no toggle can silence, and why. Kept as data so the reason is
 * reviewable rather than implied by absence from the map above.
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
