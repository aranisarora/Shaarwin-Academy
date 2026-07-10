"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { EmptyState } from "@/components/ui/EmptyState";

type Row = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { url?: string };
  read_at: string | null;
  created_at: string;
};

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
            href={row.data?.url ?? "/app"}
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
                {new Intl.DateTimeFormat("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                  timeZone: "Asia/Kolkata",
                }).format(new Date(row.created_at))}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
