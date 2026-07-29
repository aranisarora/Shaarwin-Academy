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
  // jsonb — the notify function writes `{ url }` on the rows that deep-link,
  // but the column is free-form, so read it defensively (see `deepLink`).
  data: unknown;
  read_at: string | null;
  created_at: string;
};

/** The in-app link a notification points at, or the app home when it has none. */
function deepLink(data: unknown): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const url = (data as { url?: unknown }).url;
    if (typeof url === "string" && url) return url;
  }
  return "/app";
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
            className="flex items-start gap-3 px-4 py-3.5 hover:bg-surface"
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
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
