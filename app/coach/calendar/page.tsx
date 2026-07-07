import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCoachSessions } from "@/lib/coach-data";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Calendar" };

export default async function CoachCalendarPage() {
  const { supabase, user } = await requireUser("/coach/calendar");
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 28 * 86400000);
  const sessions = await getCoachSessions(supabase, user.id, from, to);

  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(s.starts_at));
    const list = byDay.get(key) ?? [];
    list.push(s);
    byDay.set(key, list);
  }

  return (
    <CoachShell title="Calendar">
      <div className="mx-auto max-w-2xl space-y-6">
        {sessions.length === 0 && (
          <EmptyState image="/images/empty-ivory.jpg" copy="Nothing scheduled in the next four weeks." />
        )}
        {[...byDay.entries()].map(([day, rows]) => (
          <div key={day}>
            <p className="label mb-2">{day}</p>
            <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
              {rows.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/coach/session/${s.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                  >
                    <div>
                      <p className="tnum font-medium">
                        {new Intl.DateTimeFormat("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Asia/Kolkata",
                        }).format(new Date(s.starts_at))}
                      </p>
                      <p className="text-sm text-fg-2">
                        {s.classTitle} — {s.venueName ?? s.privateAddress ?? "TBC"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge tone={s.isPrivate ? "ember" : "neutral"}>
                        {s.isPrivate ? "Private" : "Group"}
                      </Badge>
                      <span className="tnum text-xs text-fg-2">
                        {s.confirmed}/{s.capacity}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </CoachShell>
  );
}
