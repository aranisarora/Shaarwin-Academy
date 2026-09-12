// When a coach may mark, or re-mark, who turned up.
//
// One definition because there were two, and they disagreed. The server action
// allowed `starts_at - 15min → starts_at + 48h`; the roster component computed
// its own copy of the opening edge and had no closing edge at all beyond that
// same literal, written again. A coach in hour 49 got buttons that looked live
// and a save that failed with "Attendance can only be set around the session."
//
// The closing edge is now seven days past the END of the session, which is the
// same backlog window `get_coach_wrapup_queue` and `get_pending_assessments`
// use. That equality is the point, not a coincidence: the prompt can only chase
// a coach for work the app will actually let them do, so the queue can always
// be driven to empty. Move one and you must move all three.

/** Attendance opens a quarter of an hour before the class does. */
export const ATTENDANCE_OPENS_BEFORE_MS = 15 * 60_000;

/** …and stays editable for a week after it ends. Same window as the backlog. */
export const ATTENDANCE_CLOSES_AFTER_MS = 7 * 86_400_000;

export type AttendanceState = "early" | "open" | "closed";

export function attendanceOpensAt(startsAt: string): number {
  return new Date(startsAt).getTime() - ATTENDANCE_OPENS_BEFORE_MS;
}

export function attendanceClosesAt(endsAt: string): number {
  return new Date(endsAt).getTime() + ATTENDANCE_CLOSES_AFTER_MS;
}

/**
 * Where `now` sits relative to the window. Takes the clock as an argument
 * rather than reading it, so the component that re-renders on a tick and the
 * action that validates a write are answering the same question the same way.
 */
export function attendanceState(
  startsAt: string,
  endsAt: string,
  now: number
): AttendanceState {
  if (now < attendanceOpensAt(startsAt)) return "early";
  if (now > attendanceClosesAt(endsAt)) return "closed";
  return "open";
}

/**
 * What to tell a coach who cannot mark right now. Says which edge they are on
 * and what to do about it — "Attendance can only be set around the session"
 * told them neither, and a coach reading it at 9am for last night's class had
 * no way to know whether to wait or to ask for help.
 */
export function attendanceClosedReason(state: AttendanceState): string | null {
  if (state === "early") return "Attendance opens 15 minutes before the class starts.";
  if (state === "closed") {
    return "This class closed for changes a week after it ran. Ask the founder to fix it.";
  }
  return null;
}
