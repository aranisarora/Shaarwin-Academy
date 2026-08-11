// The words the founder reads when a coach goes quiet around a session: the
// T-10 "hasn't confirmed" warning and the start+10 "hasn't marked arrived"
// alert, titles and bodies both.
//
// Pure and separate from index.ts for the same reason digest.ts is: the defect
// this fixes was invisible in the data and only showed up in the words. The
// session row looked identical whether the coach had tapped "Running late" or
// had ignored every message all day, because coach_mark_arrival's late branch
// wrote nothing to class_sessions — so the founder was told a coach who had
// just messaged them "never responded at all today". Migration 0071 records the
// lateness; this file is where that record turns into an honest sentence, and
// where the three cases can be pinned by a test.

/** What both escalations know about the session they are about. */
export type EscalationFacts = {
  /**
   * profiles.full_name, trimmed — "" when the profile carries no name at all.
   * The founder knows their coaches by name, so the same string names the coach
   * in the push title and in the body; the fallbacks below keep both readable
   * on the rare profile that has none.
   */
  coachName: string;
  classTitle: string;
  /**
   * classes.location_label — the curated venue for a batch, the address for a
   * private. "" when the class has neither.
   */
  location: string;
  /** The session's start, already formatted (e.g. "6:30 pm"). */
  startsClock: string;
  /** The session's end, already formatted (e.g. "7:30 pm"). */
  endsClock: string;
};

export type NotArrivedFacts = EscalationFacts & {
  /** Did the coach ever confirm they were coming? */
  confirmed: boolean;
  /**
   * When the coach reported running late, already formatted, or null if they
   * never did. The most informative fact available, so it wins over `confirmed`
   * — reporting lateness stamps the confirmation too (migration 0071), which
   * means these two are never in conflict, only in order of usefulness.
   */
  lateAtClock: string | null;
};

/**
 * Stand-ins for a coach whose profile has no name on it. Rare, but the founder
 * stops trusting an alert channel the first time it says "undefined hasn't
 * confirmed", and a bare space is worse — it reads as a bug in the class, not
 * in the profile.
 *
 * Two of them because the body puts the coach in a sentence and the title puts
 * them in a headline: "The coach confirmed they were coming" and "Coach hasn't
 * confirmed" are each the natural English for their slot.
 */
const NAMELESS_IN_BODY = "The coach";
const NAMELESS_IN_TITLE = "Coach";

function bodyName(f: EscalationFacts): string {
  return f.coachName.trim() || NAMELESS_IN_BODY;
}

function titleName(f: EscalationFacts): string {
  return f.coachName.trim() || NAMELESS_IN_TITLE;
}

/**
 * Push titles are the one part of an alert the founder is guaranteed to see,
 * and they truncate somewhere around 40-50 characters — so the coach's name
 * goes in and nothing else does. Twenty feed rows all titled "Coach hasn't
 * confirmed" are indistinguishable from each other on a banner; twenty rows
 * naming twenty coaches tell him who to ring before he opens anything. The
 * class, the venue and the times are the body's job precisely because they
 * would push the name past the truncation.
 */
export function unconfirmedTitle(f: EscalationFacts): string {
  return `${titleName(f)} hasn't confirmed`;
}

export function notArrivedTitle(f: EscalationFacts): string {
  return `${titleName(f)} hasn't marked arrived`;
}

/**
 * The venue, or an explicit admission that we don't have one.
 *
 * An empty location must not simply drop out of the sentence: the founder then
 * cannot tell "we didn't tell you where" from "this class has no venue set",
 * and only one of those needs fixing before the session starts.
 */
export function locationPhrase(location: string): string {
  return location.trim() || "location TBC";
}

/** "6:30 pm" / "7:30 pm" split into the clock part and the am/pm part. */
const MERIDIEM = /^(.*?)\s*([ap]\.?m\.?)$/i;

/**
 * "6:30-7:30 pm" — one am/pm when both ends share it, because that is how a
 * timetable is read aloud and the founder is scanning these on a phone.
 *
 * A session that straddles noon keeps both ("11:30 am-12:30 pm"): collapsing
 * there would move the class by twelve hours, which is the one error in this
 * file that would send the founder to an empty hall.
 */
export function clockRange(startClock: string, endClock: string): string {
  const start = startClock.trim();
  const end = endClock.trim();
  if (!start) return end;
  if (!end) return start;

  const s = MERIDIEM.exec(start);
  const e = MERIDIEM.exec(end);
  if (s && e && s[2].toLowerCase() === e[2].toLowerCase()) return `${s[1]}-${end}`;
  return `${start}-${end}`;
}

/**
 * "MCF Court, 6:30-7:30 pm" — the parenthetical every escalation carries.
 *
 * Without it the founder was told a coach hadn't confirmed "Junior Batch", of
 * which there are three on a Tuesday, and had to open the schedule to learn
 * which one and whether it was the court across town. The whole point of the
 * alert is that he decides in the two seconds the banner is on screen.
 */
function placeAndTime(f: EscalationFacts): string {
  return `${locationPhrase(f.location)}, ${clockRange(f.startsClock, f.endsClock)}`;
}

/**
 * T-10, and the coach has answered nothing at all. Deliberately fired before
 * the class rather than after it: this is the last moment at which a nudge or a
 * backup coach can still save the session, which is also why it names the venue
 * — arranging cover for the court across town is a different decision.
 */
export function unconfirmedBody(f: EscalationFacts): string {
  return (
    `${bodyName(f)} still hasn't confirmed they're coming to ${f.classTitle} ` +
    `(${placeAndTime(f)}) — it starts in ~10 min. A nudge or a backup plan may be worth it.`
  );
}

/**
 * Three outcomes, ordered by how much the coach has told us — because that is
 * exactly what decides whether the founder should pick up the phone.
 *
 *   told us they're late → they are handling it; watch, don't chase
 *   confirmed then quiet  → they promised and vanished; call
 *   never answered        → assume no-show; act
 *
 * Every one of these arrives AFTER whatever the coach's own action already
 * sent, so none of them may contradict it.
 *
 * Every fact here is about ONE SESSION, so every sentence must be too. The
 * third branch used to end "never responded at all today", which is a claim
 * about the whole day made from a single session's `coach_confirmed_at`. On
 * 10 Aug it told three founders that Sunil Hatti had "never responded at all
 * today — likely a no-show" about a 7pm class, eleven hours after he answered
 * the 8:50am one on two channels; fifty minutes later the same system
 * congratulated him for wrapping that 7pm session up. Same defect shape as the
 * one migration 0071 fixed for reported lateness — a true row, a false
 * sentence — just scoped by day instead of by state.
 */
export function notArrivedBody(f: NotArrivedFacts): string {
  if (f.lateAtClock) {
    return (
      `${bodyName(f)} said at ${f.lateAtClock} they were running late for ` +
      `${f.classTitle} (${placeAndTime(f)}), and still hasn't marked arrival ` +
      `10+ minutes in — worth a check.`
    );
  }
  if (f.confirmed) {
    return (
      `${bodyName(f)} confirmed they were coming to ${f.classTitle} ` +
      `(${placeAndTime(f)}) but hasn't marked arrival 10+ minutes in — call them now.`
    );
  }
  return (
    `${f.classTitle} (${placeAndTime(f)}) is 10+ minutes in and ${bodyName(f)} ` +
    `hasn't answered anything about it — likely a no-show, act now.`
  );
}
