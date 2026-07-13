import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { getCoachSessions } from "@/lib/coach-data";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { NavigateButton } from "@/components/app/NavigateButton";
import { formatAddressLine } from "@/lib/address-format";
import { ACADEMY_TZ } from "@/lib/academy-time";

export const metadata: Metadata = { title: "Schedule" };

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: ACADEMY_TZ,
  }).format(new Date(iso));
}

function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: ACADEMY_TZ,
  }).format(new Date(iso));
}

export default async function CoachSchedulePage() {
  const { supabase, user } = await requireUser("/coach");
  const coachId = await effectiveCoachId(user.id);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 28 * 86400000);
  const sessions = await getCoachSessions(supabase, coachId, from, to);

  const todayKey = dayLabel(new Date().toISOString());

  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = dayLabel(s.starts_at);
    const list = byDay.get(key) ?? [];
    list.push(s);
    byDay.set(key, list);
  }

  return (
    <CoachShell title="Schedule">
      <div className="mx-auto max-w-2xl space-y-8">
        {sessions.length === 0 && (
          <EmptyState
            image="/images/empty-ivory.jpg"
            copy="Nothing scheduled in the next four weeks."
          />
        )}

        {[...byDay.entries()].map(([day, rows]) => {
          const isToday = day === todayKey;
          return (
            <section key={day}>
              <div className="mb-3 border-b border-line pb-2">
                <p className="font-display text-2xl">
                  {isToday ? "Today" : day}
                </p>
                {isToday && <p className="text-sm text-fg-2">{day}</p>}
              </div>

              <ol className="space-y-0">
                {rows.map((s, i) => {
                  const prev = rows[i - 1];
                  const travelGap =
                    prev &&
                    (prev.venueName ?? prev.privateAddress) !==
                      (s.venueName ?? s.privateAddress);
                  const locationName =
                    s.venueName ??
                    (s.address ? formatAddressLine(s.address) : s.privateAddress) ??
                    "Location TBC";
                  const addressLine = s.venueName
                    ? [s.venueAddress, s.venuePostcode].filter(Boolean).join(", ")
                    : null;
                  const showAddressLine = !!s.venueName && !!addressLine;
                  return (
                    <li key={s.id}>
                      {travelGap && (
                        <p className="tnum py-2 text-center text-xs text-fg-2">
                          ── travel ──
                        </p>
                      )}
                      <div className="relative mb-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3.5 hover:border-ember">
                        <div className="flex items-start justify-between gap-3">
                          <Link
                            href={`/coach/session/${s.id}`}
                            aria-label={`${s.classTitle} at ${fmtTime(s.starts_at)}`}
                            className="min-w-0 after:absolute after:inset-0 after:content-['']"
                          >
                            <p className="tnum font-display text-2xl">
                              {fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}
                            </p>
                            <p className="mt-0.5 font-semibold">{locationName}</p>
                            {showAddressLine && (
                              <p className="text-sm text-fg-2">{addressLine}</p>
                            )}
                            <p className="mt-0.5 text-sm text-fg-2">
                              {s.isPrivate && s.playerName ? s.playerName : s.classTitle}
                            </p>
                          </Link>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <Badge tone={s.isPrivate ? "ember" : "neutral"}>
                              {s.isPrivate ? "Private" : "Group"}
                            </Badge>
                            <span className="tnum text-xs text-fg-2">
                              {s.confirmed}/{s.capacity}
                            </span>
                          </div>
                        </div>
                        <NavigateButton lat={s.lat} lng={s.lng} className="mt-2.5" />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </CoachShell>
  );
}
