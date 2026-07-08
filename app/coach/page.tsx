import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCoachSessions } from "@/lib/coach-data";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { WhatsAppConnect } from "@/components/app/WhatsAppConnect";

export const metadata: Metadata = { title: "Today" };

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export default async function CoachTodayPage() {
  const { supabase, user } = await requireUser("/coach");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86400000);
  const sessions = await getCoachSessions(supabase, user.id, start, end);

  const header =
    sessions.length > 0
      ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${fmtTime(sessions[0].starts_at)}–${fmtTime(sessions[sessions.length - 1].ends_at)}`
      : "No sessions today.";

  return (
    <CoachShell title="Today">
      <div className="mx-auto max-w-2xl">
        <p className="mb-6 text-fg-2">
          {new Intl.DateTimeFormat("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: "Asia/Kolkata",
          }).format(new Date())}{" "}
          — {header}
        </p>

        <div className="mb-6">
          <WhatsAppConnect />
        </div>

        {sessions.length === 0 && (
          <EmptyState image="/images/empty-ivory.jpg" copy="No sessions today." />
        )}

        <ol className="space-y-0">
          {sessions.map((s, i) => {
            const prev = sessions[i - 1];
            const travelGap =
              prev &&
              (prev.venueName ?? prev.privateAddress) !==
                (s.venueName ?? s.privateAddress);
            const mapsUrl =
              s.lat !== null
                ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`
                : null;
            return (
              <li key={s.id}>
                {travelGap && (
                  <p className="tnum py-2 text-center text-xs text-fg-2">
                    ── travel ──
                  </p>
                )}
                <Link
                  href={`/coach/session/${s.id}`}
                  className="mb-3 flex items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3.5 hover:border-ember"
                >
                  <div>
                    <p className="tnum font-display text-xl">
                      {fmtTime(s.starts_at)}
                    </p>
                    <p className="text-sm text-fg-2">
                      {s.classTitle} —{" "}
                      {s.venueName ?? s.privateAddress ?? "Location TBC"}
                    </p>
                    {mapsUrl && (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-ember underline-offset-4 hover:underline"
                      >
                        Navigate
                      </a>
                    )}
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
            );
          })}
        </ol>
      </div>
    </CoachShell>
  );
}
