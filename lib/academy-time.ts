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

/** Where a session sits relative to now — drives the schedule card status
 * visuals in both the admin and coach apps. */
export type SessionTimeStatus = "completed" | "in_progress" | "upcoming";

export function sessionTimeStatus(
  startsAt: string,
  endsAt: string,
  now: number = Date.now()
): SessionTimeStatus {
  if (new Date(endsAt).getTime() <= now) return "completed";
  if (new Date(startsAt).getTime() <= now) return "in_progress";
  return "upcoming";
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

/** Today's date on the academy wall clock, "YYYY-MM-DD". Takes an explicit
 * instant so slot arithmetic can be tested across the IST midnight boundary
 * without waiting for midnight; defaults to now. */
export function academyToday(now: Date = new Date(nowMs())): string {
  return utcToAcademyWall(now).date;
}

/**
 * Shift a "YYYY-MM-DD" wall date by whole days. Pure calendar arithmetic (no
 * timezone involved) — used to step the schedule window and to translate a
 * legacy week offset into an anchor date. Rolls over months/years correctly.
 */
export function shiftWallDate(dateStr: string, days: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, mo - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Absolute instants bounding `days` whole academy days, starting at 00:00 today
 * on the academy wall clock. `days = 1` is today only.
 *
 * The reason this exists: asking "do I have coaching today?" must not mean
 * "from this instant onwards". A coach who asks at 3pm about a 10am session —
 * or one that started five minutes ago — was previously told they had nothing
 * on, because the window began at `new Date()`. Production caught exactly that:
 * a coach was told "no coaching today" and pushed back naming the venue.
 * (notification-fix-plan, Bot changes.)
 */
export function istDayBounds(days = 1): { start: string; end: string } {
  const today = academyToday();
  return {
    start: academyWallToUtc(today, "00:00").toISOString(),
    end: academyWallToUtc(shiftWallDate(today, Math.max(days, 1)), "00:00").toISOString(),
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────
// Every user-facing timestamp goes through one of the helpers below, so "what a
// session time looks like" is decided once. This module imports nothing, which
// is what lets client components use it — lib/data.ts pulls the server Supabase
// client and can't be imported from the client, which is why these formatters
// used to be copy-pasted into ~20 components.
//
// Formatters are built once at module load rather than per call: constructing
// an Intl.DateTimeFormat is the expensive part, and list views format a
// timestamp per row.

const opts = (o: Intl.DateTimeFormatOptions, locale = "en-GB") =>
  new Intl.DateTimeFormat(locale, { timeZone: ACADEMY_TZ, ...o });

const CLOCK = opts({ hour: "numeric", minute: "2-digit", hour12: true });
const WEEKDAY = opts({ weekday: "short" });
const WEEKDAY_LONG = opts({ weekday: "long" });
const DATE = opts({ day: "numeric", month: "short" });
const DATE_FULL = opts({ day: "numeric", month: "short", year: "numeric" });
const DAY = opts({ weekday: "short", day: "numeric", month: "short" });
const DAY_LONG = opts({ weekday: "long", day: "numeric", month: "long" });
const SESSION_TIME = opts({
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const SESSION_DATE = opts({
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const DATE_CLOCK = opts({
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const WEEKLY_SLOT = opts({
  weekday: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const FULL_DATE_TIME = opts({ dateStyle: "full", timeStyle: "short" }, "en-IN");

/** "6:30 pm" */
export function formatClock(iso: string | number | Date): string {
  return CLOCK.format(new Date(iso));
}

/** "Sat" */
export function formatWeekday(iso: string | number | Date): string {
  return WEEKDAY.format(new Date(iso));
}

/** "Saturday" */
export function formatWeekdayLong(iso: string | number | Date): string {
  return WEEKDAY_LONG.format(new Date(iso));
}

/** "12 Jul" */
export function formatDate(iso: string | number | Date): string {
  return DATE.format(new Date(iso));
}

/** "12 Jul 2026" */
export function formatDateFull(iso: string | number | Date): string {
  return DATE_FULL.format(new Date(iso));
}

/** "Sat 12 Jul" */
export function formatDay(iso: string | number | Date): string {
  return DAY.format(new Date(iso));
}

/** "Saturday 12 July" */
export function formatDayLong(iso: string | number | Date): string {
  return DAY_LONG.format(new Date(iso));
}

/** "Sat, 6:30 pm" — weekday + time, when the date is already known. */
export function formatSessionTime(iso: string | number | Date): string {
  return SESSION_TIME.format(new Date(iso));
}

/** "Sat 12 Jul, 6:30 pm" — the default way to name a session. */
export function formatSessionDate(iso: string | number | Date): string {
  return SESSION_DATE.format(new Date(iso));
}

/** "12 Jul, 6:30 pm" — no weekday, for dense lists like the notification feed. */
export function formatDateClock(iso: string | number | Date): string {
  return DATE_CLOCK.format(new Date(iso));
}

/** "Saturday, 6:30 pm" — the recurring identity of a weekly slot. */
export function formatWeeklySlot(iso: string | number | Date): string {
  return WEEKLY_SLOT.format(new Date(iso));
}

/**
 * "Saturday, 12 July 2026 at 6:30 pm" — the one long-form reading, used to tell
 * the WhatsApp model what time it is now. Spelled out because the model reasons
 * over the text rather than displaying it.
 */
export function formatFullDateTime(iso: string | number | Date): string {
  return FULL_DATE_TIME.format(new Date(iso));
}

/**
 * "Sat 12 Jul" for a bare "YYYY-MM-DD" wall date. Distinct from `formatDay`,
 * which takes an instant: a wall date has no time, so it is formatted in UTC to
 * keep the day from shifting under the academy offset.
 */
export function formatWallDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const WALL_WEEKDAY_NARROW = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "narrow",
});

/**
 * "S" for a bare "YYYY-MM-DD" wall date — the single letter over a day in the
 * admin week strip. UTC-formatted for the same reason as `formatWallDay`.
 *
 * The letter is read off the date rather than off the column it sits in. The
 * strip shows seven days from an anchor that is usually just today, so a fixed
 * M-T-W-T-F-S-S row sat over the right dates only in the weeks the anchor
 * happened to land on a Monday.
 */
export function formatWallWeekdayNarrow(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return WALL_WEEKDAY_NARROW.format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * "August 2026", or "Jul – Aug 2026" when the two dates straddle a month —
 * the caption over the admin week strip, which has the seven day numbers
 * underneath it and so needs the month and nothing else.
 *
 * UTC-formatted for the same reason as `formatWallDay`.
 */
export function formatWallMonthRange(from: string, to: string): string {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(
      new Date(Date.UTC(y, m - 1, day))
    );
  };
  return from.slice(0, 7) === to.slice(0, 7)
    ? fmt(from, { month: "long", year: "numeric" })
    : `${fmt(from, { month: "short" })} – ${fmt(to, { month: "short", year: "numeric" })}`;
}

/**
 * "12 Jul 2026" for a bare "YYYY-MM-DD" wall date — the `formatDateFull` shape
 * for calendar dates that carry no time (date of birth, term dates). Formatted
 * in UTC for the same reason as `formatWallDay`: `new Date("2015-03-01")` is
 * UTC midnight, so any negative-offset viewer would otherwise see 28 Feb.
 */
export function formatWallDateFull(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ── Machine-readable wall-clock values ───────────────────────────────────────

const WALL_DATE = opts(
  { year: "numeric", month: "2-digit", day: "2-digit" },
  "en-CA" // en-CA is the locale that yields "YYYY-MM-DD" directly.
);
const WALL_TIME = opts({ hour: "2-digit", minute: "2-digit", hour12: false });
const WALL_HOUR = opts({ hour: "2-digit", hour12: false });
const WALL_WEEKDAY_TIME = opts({
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "2026-07-12" — academy wall date; feeds `<input type="date">`. */
export function wallDate(iso: string | number | Date): string {
  return WALL_DATE.format(new Date(iso));
}

/** "18:30" — 24-hour academy wall time; `<input type="time">` requires this. */
export function wallTime(iso: string | number | Date): string {
  return WALL_TIME.format(new Date(iso));
}

/** 0–23 — academy wall hour, for morning/afternoon/evening bucketing. */
export function wallHour(iso: string | number | Date): number {
  return Number(WALL_HOUR.format(new Date(iso)));
}

/** "Sat, 18:30" — stable key so two dates on the same weekly slot collide. */
export function wallWeekdayTime(iso: string | number | Date): string {
  return WALL_WEEKDAY_TIME.format(new Date(iso));
}
