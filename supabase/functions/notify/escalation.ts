// The sentence the founder reads when a class is 10+ minutes in and its coach
// has not marked arrival.
//
// Pure and separate from index.ts for the same reason digest.ts is: the defect
// this fixes was invisible in the data and only showed up in the words. The
// session row looked identical whether the coach had tapped "Running late" or
// had ignored every message all day, because coach_mark_arrival's late branch
// wrote nothing to class_sessions — so the founder was told a coach who had
// just messaged them "never responded at all today". Migration 0071 records the
// lateness; this file is where that record turns into an honest sentence, and
// where the three cases can be pinned by a test.

export type NotArrivedFacts = {
  /** The coach's name as the founder knows them. */
  coachName: string;
  classTitle: string;
  /** The session's own start time, already formatted (e.g. "6:30 pm"). */
  when: string;
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
 * Three outcomes, ordered by how much the coach has told us — because that is
 * exactly what decides whether the founder should pick up the phone.
 *
 *   told us they're late → they are handling it; watch, don't chase
 *   confirmed then quiet  → they promised and vanished; call
 *   never answered        → assume no-show; act
 *
 * Every one of these arrives AFTER whatever the coach's own action already
 * sent, so none of them may contradict it.
 */
export function notArrivedBody(f: NotArrivedFacts): string {
  if (f.lateAtClock) {
    return (
      `${f.coachName} said at ${f.lateAtClock} they were running late for ` +
      `${f.classTitle} (${f.when}), and still hasn't marked arrival 10+ minutes in ` +
      `— worth a check.`
    );
  }
  if (f.confirmed) {
    return (
      `${f.coachName} confirmed they were coming to ${f.classTitle} (${f.when}) ` +
      `but hasn't marked arrival 10+ minutes in — call them now.`
    );
  }
  return (
    `${f.classTitle} (${f.when}) is 10+ minutes in and ${f.coachName} never ` +
    `responded at all today — likely a no-show, act now.`
  );
}
