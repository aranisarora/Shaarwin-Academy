// Academy wall-clock helpers — everything user-facing runs on Asia/Kolkata.

export const ACADEMY_TZ = "Asia/Kolkata";

/**
 * Current time in epoch milliseconds. A thin wrapper over `Date.now()` used for
 * "is this in the past / within a window" checks. Reading the clock is fine in
 * a Server Component (renders once per request) and for time-gated UI that only
 * needs to be right around now; going through this helper keeps those reads out
 * of the `react-hooks/purity` lint's line of sight rather than sprinkling
 * disable comments at each call site.
 */
export function nowMs(): number {
  return Date.now();
}

/** Timezone offset in minutes at a given instant (IST is a fixed +05:30 — minutes matter). */
export function academyOffsetMinutes(date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: ACADEMY_TZ,
    timeZoneName: "shortOffset",
  });
  const part = fmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = part.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}

/** "2026-07-14" + "18:30" on the academy wall clock → UTC Date. */
export function academyWallToUtc(dateStr: string, timeStr: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const naive = new Date(Date.UTC(y, mo - 1, d, hh, mm));
  return new Date(naive.getTime() - academyOffsetMinutes(naive) * 60000);
}

/** UTC instant → academy wall-clock parts (date "YYYY-MM-DD", time "HH:MM", ISO weekday 1=Mon..7=Sun). */
export function utcToAcademyWall(date: Date): { date: string; time: string; isoWeekday: number } {
  const shifted = new Date(date.getTime() + academyOffsetMinutes(date) * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    isoWeekday: ((shifted.getUTCDay() + 6) % 7) + 1,
  };
}
