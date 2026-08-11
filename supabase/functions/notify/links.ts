// Whether a notification can hand you the thing it is about, and how that link
// survives being squeezed into a WhatsApp template variable.
//
// The founder's alerts learned to deep-link to a session — /admin/schedule?date=
// &session=… rather than "here is the week, go and find it" — and the Alerts
// feed grew an "Open the session" affordance to match. WhatsApp got neither.
// It is built from `title` and `body` alone (see deliverWhatsApp), so the one
// channel the founder actually reads at 6:30pm was the one still saying "Ravi
// hasn't marked arrived" and leaving him to work out which Ravi, which class,
// and where.
//
// Pure and separate from index.ts for the reason digest.ts and escalation.ts
// are: index.ts is Deno, is excluded from tsconfig.json, and nothing in CI
// typechecks or exercises it. Anything here is plain TypeScript with no Deno
// globals, so vitest covers it (see links.test.ts) — and the truncation rule
// below is exactly the kind of off-by-a-URL that no one would catch by reading.

/** Enough of a notification row to decide what its message should say. */
export type LinkableData = Record<string, unknown> | null | undefined;

/**
 * `data` narrowed to something we can read keys off, or an empty object. The
 * column is jsonb written by a dozen Postgres functions and the worker itself,
 * and nothing in the schema makes it an object.
 */
function fields(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

/**
 * Does this row land on ONE named session, rather than on a screen the reader
 * then has to search? Returns the app-relative url when it does.
 *
 * Both halves have to agree, and each rejects something real. `session_id` on
 * its own is not enough: rows carry it for the sender's benefit while pointing
 * at a day view or a digest. A `session` query param on its own is not enough
 * either — /coach/players/<player>?session=<id> uses the same word to mean "the
 * class this assessment belongs to", and that link opens a player. So only the
 * two shapes we actually emit match.
 *
 * DELIBERATELY THE SAME RULE as opensOneSession() in NotificationsList.tsx,
 * which decides whether the feed row shows its "Open the session" button. One
 * notification should not offer the link on one surface and withhold it on the
 * other. It cannot be imported across the Deno/Next boundary, so it is restated
 * here — the same trade the TYPES block at the top of index.ts makes.
 */
export function sessionPath(data: LinkableData): string {
  const d = fields(data);
  if (typeof d.session_id !== "string" || !d.session_id) return "";
  if (typeof d.url !== "string") return "";

  const mark = d.url.indexOf("?");
  const path = mark === -1 ? d.url : d.url.slice(0, mark);
  const query = mark === -1 ? "" : d.url.slice(mark + 1);

  if (/^\/coach\/session\/[^/]+$/.test(path)) return d.url;
  if (path === "/admin/schedule" && new URLSearchParams(query).get("session")) return d.url;
  return "";
}

/**
 * The absolute link for a row, or "" when it isn't about one session.
 *
 * The trailing slash matters. APP_URL is an env var, and a value set as
 * "https://sharwinacademy.com/" would otherwise produce
 * "https://sharwinacademy.com//admin/schedule" — which most routers survive and
 * some proxies do not, on a link whose entire job is to work first time.
 */
export function sessionLink(data: LinkableData, appUrl: string): string {
  const path = sessionPath(data);
  return path ? `${appUrl.replace(/\/+$/, "")}${path}` : "";
}

/** A link needs at least this many characters of message in front of it to be
 *  worth sending. Below that we would be delivering a bare URL, which reads as
 *  spam and tells the founder nothing he could act on from the banner. */
const MIN_MESSAGE = 40;

const HAS_URL = /https?:\/\//i;

/**
 * `text` with `link` on the end, inside a `max`-character budget.
 *
 * The budget is the whole point. WhatsApp rejects an over-long template
 * variable, so the outside-the-24h-window path caps the message — and a cap
 * applied after the link is appended cuts the URL in half. A 404 is worse than
 * a sentence that stops early, so the link is reserved first and the words take
 * what is left.
 *
 * A body that already carries a link keeps it and gains nothing: coach_after_class
 * writes its own url into its sentence, and two links a few words apart is both
 * noise and a chance for them to disagree.
 */
export function appendLink(text: string, link: string, max: number, separator: string): string {
  const body = String(text ?? "").trim();
  if (!link || HAS_URL.test(body)) return body.slice(0, max);

  const room = max - link.length - separator.length;
  // Not enough room to say anything alongside it — keep the words, drop the
  // link. The reader still has the app.
  if (room < MIN_MESSAGE) return body.slice(0, max);

  return `${body.slice(0, room).trimEnd()}${separator}${link}`;
}
