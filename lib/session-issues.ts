// What one session is still waiting on, and how to say it in a chip.
//
// This used to live inside ClassCard as a local `outstanding()`. It moved out
// for one reason: THE CARD AND THE SHEET MUST AGREE. A card is a summary and a
// sheet is the detail behind it, so a card that shows two red chips and a sheet
// that opens on a clean-looking session is not a smaller view of the same fact —
// it is a contradiction, and the founder has no way to tell which half is lying.
// Both now read this file.
//
// WHAT COUNTS AS AN ISSUE IS "SOMETHING A HUMAN STILL OWES", not "something is
// unusual". A coach who turned up twelve minutes late is a fact worth printing —
// it is why the parents were standing around — but there is nothing left to do
// about it, so it does not make `any` true and never puts a session in the
// needs-attention list. Only work that can still be done gets to raise a flag.
//
// The counts themselves come from lib/session-followthrough.ts, which restates
// the definitions `get_coach_wrapup_queue` chases coaches with. This file only
// decides WHEN they are owed and HOW they read.

import { sessionTimeStatus } from "@/lib/academy-time";

/** Minutes after the start bell before "arrived" becomes "arrived late".
 *
 * A coach walking in at 6:03 for a 6:00 class did not let anyone down, and a
 * chip calling that out would be the app crying wolf about the one signal it
 * most needs believed. Five minutes is where a parent starts looking at the
 * door. */
export const LATE_ARRIVAL_GRACE_MIN = 5;

/** "45 min" / "1h" / "1h 20m" — a gap, at the length it deserves. Minutes stay
 *  minutes up to the hour because "20 min early" is the sentence a person says;
 *  past that they say "an hour and a bit", so the unit changes with them. */
function formatGap(totalMin: number): string {
  const mins = Math.max(0, Math.round(totalMin));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export type ArrivalTiming = {
  /** Minutes between the class starting and the coach arriving; negative = early. */
  offsetMin: number;
  /** Past the grace. Drives the chip's colour, not its existence. */
  late: boolean;
  /** "20 min early" · "on time" · "12 min late" */
  label: string;
};

/**
 * When the coach got there, relative to the class.
 *
 * The card used to print the wall clock — "✓ Arrived 6:12 pm" — which asks the
 * founder to do arithmetic against a start time printed two lines up, on every
 * card, in a list of thirty. The number he actually wants is the difference, so
 * the card should be the thing that subtracts. The absolute time is still in the
 * sheet, where there is room for both and a dispute needs a timestamp.
 */
export function arrivalTiming(
  arrivedAt: string | number | Date,
  startsAt: string | number | Date
): ArrivalTiming {
  const offsetMin = Math.round(
    (new Date(arrivedAt).getTime() - new Date(startsAt).getTime()) / 60_000
  );
  if (offsetMin <= -1) {
    return { offsetMin, late: false, label: `${formatGap(-offsetMin)} early` };
  }
  if (offsetMin > LATE_ARRIVAL_GRACE_MIN) {
    return { offsetMin, late: true, label: `${formatGap(offsetMin)} late` };
  }
  return { offsetMin, late: false, label: "on time" };
}

/** The fields any caller must be able to answer about. Structural on purpose —
 *  SessionRow lives with the calendar components, and the card, the sheet and
 *  anything later that grows a "what's outstanding" view should not all have to
 *  be that exact shape to ask this question. */
export type IssueInput = {
  status: string;
  starts_at: string;
  ends_at: string;
  coachId: string | null;
  coachArrivedAt: string | null;
  rosterUnmarked: number;
  assessPending: number;
};

export type SessionIssues = {
  /** When the coach got there, if anyone has said. */
  arrival: ArrivalTiming | null;
  /** Started, has a coach, and nobody has marked them in. */
  noArrival: boolean;
  /** Players still sitting on 'confirmed' after the class ended. */
  attendance: number;
  /** Players marked present that nobody has rated. */
  assess: number;
  /** Is anyone still owing anything? A late arrival is not owed — see the note
   *  at the top of this file. */
  any: boolean;
  /**
   * Did this class go right?
   *
   * Wider than `any` in both directions it can be. A class with nobody rostered
   * owes no paperwork at all and is the most broken thing the schedule can
   * draw; a coach who walked in twelve minutes late leaves no job behind but
   * the parents still stood there waiting. Neither is "outstanding work", and
   * both mean the class did not go right.
   *
   * Answered whether or not the class has run — this file reports what is true
   * and the caller decides when the question is worth asking. The card only
   * paints it on sessions that are over, because a verdict on a class that has
   * not happened yet is a guess.
   */
  wentWrong: boolean;
};

const NO_ISSUES: SessionIssues = {
  arrival: null,
  noArrival: false,
  attendance: 0,
  assess: 0,
  any: false,
  wentWrong: false,
};

/**
 * What this session is still waiting on, as of `now`.
 *
 * Nothing is owed on a class that did not happen, so a cancelled session comes
 * back clean rather than accusing anybody of not keeping a register for it.
 */
export function sessionIssues(session: IssueInput, now?: number): SessionIssues {
  if (session.status === "cancelled") return NO_ISSUES;
  const status = sessionTimeStatus(session.starts_at, session.ends_at, now);

  // A session nobody is rostered on has nobody to arrive: the empty coach slot
  // is the story on that card, and it is told in words of its own.
  const arrivedAt = session.coachId ? session.coachArrivedAt : null;
  const arrival = arrivedAt ? arrivalTiming(arrivedAt, session.starts_at) : null;
  // Silent until it has actually started. A "no arrival" chip on every future
  // class in the week would be a report of nothing, on the cards with the least
  // to say — and he would learn to read past the whole row.
  const noArrival = session.coachId != null && !arrivedAt && status !== "upcoming";

  // The register and the ratings are only owed once the class is over. A coach
  // marking a register mid-class is normal and being half-done at 4pm is not a
  // failure, so chasing it while the whistle is still going would train him to
  // ignore the one row that matters at 6pm.
  const over = status === "completed";
  const attendance = over ? session.rosterUnmarked : 0;
  const assess = over ? session.assessPending : 0;

  const any = noArrival || attendance > 0 || assess > 0;
  return {
    arrival,
    noArrival,
    attendance,
    assess,
    any,
    wentWrong: any || session.coachId == null || arrival?.late === true,
  };
}
