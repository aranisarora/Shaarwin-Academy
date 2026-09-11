/**
 * The one coupling between this site and bluetick, the system that now runs the
 * academy's scheduling and its WhatsApp assistant.
 *
 * Bluetick publishes a read-only diary for any workspace whose owner has turned
 * the public diary on:
 *
 *   GET {BLUETICK_URL}/api/diary/{key}?from=YYYY-MM-DD&days=N
 *
 * The window is [from 00:00, from+days 00:00) on the WORKSPACE's clock, and
 * every timestamp comes back with that workspace's UTC offset attached
 * (…+05:30), never a trailing Z. That is deliberate: the schedule page must
 * render academy wall-clock time without knowing what timezone the academy is
 * in, so it reads the offset that is already in the string and does not
 * re-zone.
 *
 * This module never throws. A timetable that cannot be loaded is a page with a
 * stated gap and a WhatsApp link on it — not a 500, and never an empty grid
 * that reads as "no classes this week".
 */

export type DiaryEvent = {
  id: string;
  title: string;
  /** ISO 8601 carrying the workspace's UTC offset, e.g. 2026-09-14T18:00:00+05:30. */
  starts_at: string;
  ends_at: string | null;
  status: "scheduled" | "cancelled";
  host: { id: string; label: string } | null;
  capacity: number | null;
  /** Bookings at status booked or attended. */
  taken: number;
  series_key: string | null;
  attrs: DiaryEventAttrs;
};

/** event.attrs as bluetick's Sharwin import writes them. */
export type DiaryEventAttrs = {
  kind?: "group" | "private" | "school";
  venue?: string | null;
  venue_unit?: string | null;
  address?: string | null;
  school?: boolean;
  imported?: string;
  [key: string]: unknown;
};

export type Diary = {
  workspace: { name: string; timezone: string; key: string };
  from: string;
  until: string;
  events: DiaryEvent[];
};

export type DiaryResult =
  | { ok: true; diary: Diary }
  | { ok: false; reason: string };

/** How long a fetched week is reused. Matches the endpoint's own s-maxage. */
const REVALIDATE_SECONDS = 300;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Loose validation: the contract is fixed, but a bad deploy on either side must
 * degrade to "we can't show the timetable" rather than to a render crash. Each
 * event is checked for the fields the page actually reads; anything else is
 * passed through as-is.
 */
function parseDiary(body: unknown): Diary | null {
  if (!isRecord(body) || body.ok !== true) return null;
  const ws = body.workspace;
  if (!isRecord(ws) || typeof ws.name !== "string" || typeof ws.timezone !== "string") {
    return null;
  }
  if (typeof body.from !== "string" || typeof body.until !== "string") return null;
  if (!Array.isArray(body.events)) return null;

  const events: DiaryEvent[] = [];
  for (const raw of body.events) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== "string" || typeof raw.title !== "string") continue;
    if (typeof raw.starts_at !== "string") continue;
    const host = isRecord(raw.host) && typeof raw.host.label === "string"
      ? { id: String(raw.host.id ?? ""), label: raw.host.label }
      : null;
    events.push({
      id: raw.id,
      title: raw.title,
      starts_at: raw.starts_at,
      ends_at: typeof raw.ends_at === "string" ? raw.ends_at : null,
      status: raw.status === "cancelled" ? "cancelled" : "scheduled",
      host,
      capacity: typeof raw.capacity === "number" ? raw.capacity : null,
      taken: typeof raw.taken === "number" ? raw.taken : 0,
      series_key: typeof raw.series_key === "string" ? raw.series_key : null,
      attrs: isRecord(raw.attrs) ? (raw.attrs as DiaryEventAttrs) : {},
    });
  }

  return {
    workspace: {
      name: ws.name,
      timezone: ws.timezone,
      key: typeof ws.key === "string" ? ws.key : "",
    },
    from: body.from,
    until: body.until,
    events,
  };
}

/**
 * Fetch one window of the academy's public diary.
 *
 * `from` is a date on the academy's clock; omitting it lets bluetick default to
 * today on that clock, which is the right answer for a visitor in any timezone.
 */
export async function fetchDiary(
  { from, days = 7 }: { from?: string; days?: number } = {}
): Promise<DiaryResult> {
  const base = process.env.BLUETICK_URL?.replace(/\/$/, "");
  const key = process.env.BLUETICK_DIARY_KEY;
  if (!base || !key) return { ok: false, reason: "not_configured" };

  const params = new URLSearchParams({ days: String(days) });
  if (from) params.set("from", from);
  const url = `${base}/api/diary/${encodeURIComponent(key)}?${params}`;

  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "bad_json" };
  }

  const diary = parseDiary(body);
  return diary ? { ok: true, diary } : { ok: false, reason: "bad_shape" };
}
