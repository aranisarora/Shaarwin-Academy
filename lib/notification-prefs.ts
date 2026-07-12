// Per-type notification toggles, shared by the profile editor and the
// onboarding notifications step. Transactional types (payment_failed,
// session_cancelled) always deliver and aren't listed.
export const PREF_TYPES: [string, string][] = [
  ["reminder_24h", "Session reminders (day before)"],
  ["reminder_2h", "Session reminders (2 hours)"],
  ["waitlist_spot", "Waitlist openings"],
  ["coach_changed", "Coach changes"],
  ["booking_rescheduled", "Reschedule confirmations"],
  ["renewal_upcoming", "Renewal notices"],
];
