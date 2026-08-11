"use client";

import Link from "next/link";
import { formatDateClock } from "@/lib/academy-time";
import { createClient } from "@/lib/supabase/client";
import { EmptyState } from "@/components/ui/EmptyState";

type Row = {
  id: string;
  type: string;
  title: string;
  body: string;
  // jsonb — the notify function writes `{ url }` on the rows that deep-link and
  // `{ session_id }` on the ones about a single class, but the column is
  // free-form, so read it defensively (see `fields`).
  data: unknown;
  read_at: string | null;
  created_at: string;
};

/**
 * `data` narrowed to something we can read keys off, or an empty object.
 *
 * Every reader below goes through here rather than casting at the point of use.
 * The column is written by a dozen different Postgres functions and nothing in
 * the schema makes it an object — one of them writing an array or a bare string
 * would take the founder's whole feed down with a TypeError, on the one screen
 * whose job is to prove that nothing has gone quiet.
 */
function fields(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

/** The in-app link a notification points at, or the app home when it has none. */
function deepLink(data: unknown): string {
  const url = fields(data).url;
  return typeof url === "string" && url ? url : "/app";
}

/**
 * Does this row land on ONE named session, rather than on a screen the founder
 * then has to search?
 *
 * Both halves have to agree, and each is there to reject something real.
 * `session_id` on its own is not enough: rows carry it for the sender's benefit
 * while pointing at a day view or a digest, and promising "Open the session" on
 * those would be a lie. A `session` query param on its own is not enough
 * either — `/coach/players/<player>?session=<id>` uses the same word to mean
 * "the class this assessment belongs to", and that link opens a player. So we
 * match only the two shapes we actually emit, the founder's schedule opened on
 * a session and a coach's session page, and let everything else be a plain row.
 */
function opensOneSession(data: unknown): boolean {
  const d = fields(data);
  if (typeof d.session_id !== "string" || !d.session_id) return false;
  if (typeof d.url !== "string") return false;

  const mark = d.url.indexOf("?");
  const path = mark === -1 ? d.url : d.url.slice(0, mark);
  const query = mark === -1 ? "" : d.url.slice(mark + 1);

  if (/^\/coach\/session\/[^/]+$/.test(path)) return true;
  return (
    path === "/admin/schedule" &&
    Boolean(new URLSearchParams(query).get("session"))
  );
}

export function NotificationsList({ rows }: { rows: Row[] }) {
  const supabase = createClient();

  async function markRead(id: string) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
  }

  if (rows.length === 0) {
    return (
      <EmptyState image="/images/empty-ivory.jpg" copy="Nothing yet — quiet table." />
    );
  }

  return (
    <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={deepLink(row.data)}
            onClick={() => markRead(row.id)}
            className="group flex items-start gap-3 px-4 py-3.5 hover:bg-surface"
          >
            <span
              aria-hidden
              className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                row.read_at ? "bg-line" : "bg-ember"
              }`}
            />
            <span>
              <span className="block font-medium">{row.title}</span>
              <span className="block text-sm text-fg-2">{row.body}</span>
              <span className="mt-0.5 block text-xs text-fg-2">
                {formatDateClock(row.created_at)}
              </span>
              {/*
                A <span> dressed as a button, and it has to stay a span. The row
                is already an <a>, and a link may not contain another link or a
                <button>: the parser closes the outer anchor the moment it meets
                a nested <a>, and a nested <button> eats the click in some
                browsers and passes it through in others. Either way the founder
                presses the one thing on the row that looks pressable and the
                row never marks itself read — he opens the session, comes back,
                and the alert is still sitting there unread. So the row stays
                the only hit target; this just tells him where it goes. Making
                this a real control means first making the row not be one.
              */}
              {opensOneSession(row.data) && (
                <span className="pressable mt-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-[8px] border border-line px-4 text-sm font-semibold text-fg group-hover:border-ember group-hover:text-ember">
                  Open the session
                  <span aria-hidden>→</span>
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
