// The founder's 21:00 summary — pure presentation, no I/O.
//
// Split out of index.ts so it can be unit-tested. Everything else in the worker
// needs a Deno runtime, a live Postgres and a Twilio account to exercise; this
// is the part with the actual branching (who was late, who marked nothing, who
// was never rostered) and it is a pure function of one array. Deliberately free
// of Deno globals so `vitest` can import it directly — see digest.test.ts.
//
// Read by supabase/functions/notify/index.ts (sweepFounderDigest).

/** One row of `founder_day_report(p_date)` — see migration 0057. */
export type DayReportRow = {
  class_title: string;
  /** NULL when the session had no coach assigned at all. (Migration 0057.) */
  coach_name: string | null;
  time_str: string;
  arrived_at: string | null;
  minutes_late: number | null;
  arrival_source: string | null;
  roster_size: number;
  roster_marked: number;
};

export type DaySummary = {
  punctuality: string;
  rosters: string;
  byCoach: string;
  adoption: string;
  attention: string;
};

/** How late a coach can be before it is worth the founder's attention. */
export const LATE_THRESHOLD_MIN = 5;

/** Coaches named in the per-coach line before it truncates. */
const COACHES_SHOWN = 10;

/** Most coaches are unambiguous by first name, and the line has to fit a phone. */
function shortNames(full: string[]): Map<string, string> {
  const firsts = new Map<string, number>();
  for (const f of full) {
    const first = f.split(/\s+/)[0];
    firsts.set(first, (firsts.get(first) ?? 0) + 1);
  }
  // Two Augustines on the same day and the digest names them in full — a
  // shortened name that maps to two people is worse than a long one.
  return new Map(
    full.map((f) => [f, (firsts.get(f.split(/\s+/)[0]) ?? 0) > 1 ? f : f.split(/\s+/)[0]])
  );
}

/**
 * Four newline-free lines: punctuality, roster completion, per-coach arrival
 * marking, and the exceptions worth acting on.
 *
 * `byCoach` is the line the founder asked for, and the one the digest has never
 * carried. The old shape reported per SESSION and truncated at three names, so
 * on a normal day it said "Augustine never marked arrival (X) · +6 more
 * unmarked" — which names one coach, hides the rest, and cannot answer "who is
 * actually using this?" at all. Arrival marking is the academy's only per-coach
 * adoption signal, so it is now reported per coach, every coach, with an
 * aggregate ahead of it.
 *
 * Every line must stay newline-free: WhatsApp rejects newlines inside a template
 * VARIABLE (the body may contain them, the variable may not), and each of these
 * is one variable of founder_daily_digest_v3.
 */
export function summariseDay(rows: DayReportRow[]): DaySummary {
  // Unassigned sessions are a scheduling gap, not a coach failure — they are
  // excluded from every coach-facing statistic and reported on their own in
  // `attention`. Before migration 0057 they arrived here named "Unassigned" and
  // were counted as a coach who ignored the prompt.
  const unassigned = rows.filter((r) => r.coach_name === null);
  const staffed = rows.filter((r) => r.coach_name !== null) as (DayReportRow & {
    coach_name: string;
  })[];

  const total = staffed.length;
  const late = staffed.filter((r) => (r.minutes_late ?? 0) >= LATE_THRESHOLD_MIN);
  const missing = staffed.filter((r) => r.arrived_at === null);
  const onTime = total - late.length - missing.length;

  const punctuality = total
    ? `${onTime} of ${total} ${total === 1 ? "session" : "sessions"} started on time` +
      (late.length
        ? ` · ${late
            .slice(0, 3)
            .map((r) => `${r.coach_name} ${r.minutes_late} min late (${r.class_title})`)
            .join(" · ")}${late.length > 3 ? ` · +${late.length - 3} more` : ""}`
        : "")
    : "no staffed sessions today";

  // A session with nobody booked has no roster to mark, so it can't count
  // against a coach — otherwise a quiet day reads as a day of neglect.
  const withRoster = staffed.filter((r) => r.roster_size > 0);
  const marked = withRoster.filter((r) => r.roster_marked >= r.roster_size);
  const blank = withRoster.filter((r) => r.roster_marked === 0);
  const rosters = withRoster.length
    ? `${marked.length} of ${withRoster.length} rosters marked` +
      (blank.length ? ` · ${blank.length} left blank` : "")
    : "no rosters to mark";

  // ── Per-coach arrival marking ─────────────────────────────────────────────
  const perCoach = new Map<string, { sessions: number; arrived: number }>();
  for (const r of staffed) {
    const acc = perCoach.get(r.coach_name) ?? { sessions: 0, arrived: 0 };
    acc.sessions++;
    if (r.arrived_at !== null) acc.arrived++;
    perCoach.set(r.coach_name, acc);
  }
  const short = shortNames([...perCoach.keys()]);
  // Worst first — the founder reads left to right and the names that need a
  // phone call should not be at the end of the line. Ties break on volume, so a
  // coach who missed four is ahead of one who missed one.
  const ranked = [...perCoach.entries()].sort(
    (a, b) =>
      a[1].arrived / a[1].sessions - b[1].arrived / b[1].sessions ||
      b[1].sessions - a[1].sessions ||
      a[0].localeCompare(b[0])
  );
  const byCoach = ranked.length
    ? ranked
        .slice(0, COACHES_SHOWN)
        .map(([name, s]) => `${short.get(name)} ${s.arrived}/${s.sessions}`)
        .join(" · ") +
      (ranked.length > COACHES_SHOWN ? ` · +${ranked.length - COACHES_SHOWN} more` : "")
    : "no coaches on today";

  const usedIt = ranked.filter(([, s]) => s.arrived > 0).length;
  const adoption = ranked.length
    ? `${usedIt} of ${ranked.length} ${ranked.length === 1 ? "coach" : "coaches"} marked arrival at least once`
    : "no coaches on today";

  // ── What needs the founder ────────────────────────────────────────────────
  //
  // Coaches at zero are named here rather than the per-session list this line
  // used to hold: "Augustine 0/3" already appears above, and repeating each of
  // his three sessions crowds out everything else.
  const parts: string[] = [];
  for (const s of unassigned.slice(0, 3)) {
    parts.push(`${s.class_title} (${s.time_str}) had NO coach`);
  }
  if (unassigned.length > 3) parts.push(`+${unassigned.length - 3} more with no coach`);

  const silent = ranked.filter(([, s]) => s.arrived === 0);
  for (const [name, s] of silent.slice(0, 3)) {
    parts.push(`${short.get(name)} marked none of ${s.sessions}`);
  }
  if (silent.length > 3) parts.push(`+${silent.length - 3} more marked none`);

  for (const r of blank.slice(0, 2)) parts.push(`${r.class_title} roster still blank`);

  const attention = parts.length ? parts.join(" · ") : "Nothing — a clean day.";

  return { punctuality, rosters, byCoach, adoption, attention };
}
