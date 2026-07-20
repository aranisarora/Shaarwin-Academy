import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { getCoachSessions, type CoachSession } from "@/lib/coach-data";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { NavigateButton } from "@/components/app/NavigateButton";
import { AutoOpenSession } from "@/components/app/AutoOpenSession";
import { ACADEMY_TZ, nowMs, sessionTimeStatus } from "@/lib/academy-time";

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

/** Card's third line: the client's name for a private, else "Group class". */
function classTypeLine(s: CoachSession): string {
  if (s.isPrivate) return s.playerName ?? "Private session";
  return "Group class";
}

export default async function CoachSchedulePage() {
  const { supabase, user } = await requireUser("/coach");
  const coachId = await effectiveCoachId(user.id);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 28 * 86400000);
  const sessions = await getCoachSessions(supabase, coachId, from, to);

  const now = nowMs();
  const todayKey = dayLabel(new Date().toISOString());

  // The session to spotlight (rendered larger): whatever is happening right
  // now, or — if nothing is live — the very next one still to come. A live
  // session also auto-opens so the coach lands on attendance immediately.
  const liveSession = sessions.find(
    (s) => sessionTimeStatus(s.starts_at, s.ends_at, now) === "in_progress"
  );
  const nextUpcoming = sessions.find(
    (s) => sessionTimeStatus(s.starts_at, s.ends_at, now) === "upcoming"
  );
  const featuredId = (liveSession ?? nextUpcoming)?.id ?? null;

  // Group by day; within each day, finished sessions sink below the live and
  // upcoming ones so the coach's attention lands on what's next.
  const byDay = new Map<string, CoachSession[]>();
  for (const s of sessions) {
    const key = dayLabel(s.starts_at);
    const list = byDay.get(key) ?? [];
    list.push(s);
    byDay.set(key, list);
  }
  for (const [key, rows] of byDay) {
    byDay.set(key, [
      ...rows.filter((s) => sessionTimeStatus(s.starts_at, s.ends_at, now) !== "completed"),
      ...rows.filter((s) => sessionTimeStatus(s.starts_at, s.ends_at, now) === "completed"),
    ]);
  }

  return (
    <CoachShell title="Schedule">
      {liveSession && <AutoOpenSession sessionId={liveSession.id} />}
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
                  const status = sessionTimeStatus(s.starts_at, s.ends_at, now);
                  const featured = s.id === featuredId;
                  // Venue name for group classes; for privates, the area (POI
                  // name or neighbourhood) — never the exact street, which the
                  // "Open maps" button covers.
                  const locationName =
                    s.venueName ??
                    s.address?.name ??
                    s.address?.locality ??
                    s.address?.subLocality ??
                    "Private session";

                  // Completed = greyed and quiet. Featured (live or next up) =
                  // larger with an ember frame. Everything else is a plain card.
                  const tone =
                    status === "completed"
                      ? "border-line bg-surface-2 opacity-55"
                      : featured
                        ? "border-ember bg-surface-2 shadow-[0_0_0_1px_var(--ember)]"
                        : "border-line bg-surface-2 hover:border-ember";
                  const timeClass = featured ? "text-3xl" : "text-2xl";

                  return (
                    <li key={s.id}>
                      {travelGap && (
                        <p className="tnum py-2 text-center text-xs text-fg-2">
                          ── travel ──
                        </p>
                      )}
                      <div
                        className={`relative mb-3 rounded-[12px] border px-4 ${featured ? "py-4" : "py-3.5"} ${tone}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <Link
                            href={`/coach/session/${s.id}`}
                            aria-label={`${locationName} at ${fmtTime(s.starts_at)}`}
                            className="min-w-0 after:absolute after:inset-0 after:content-['']"
                          >
                            <p className="font-semibold">{locationName}</p>
                            <p className={`tnum font-display ${timeClass}`}>
                              {fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}
                            </p>
                            <p className="mt-0.5 text-sm text-fg-2">{classTypeLine(s)}</p>
                          </Link>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            {status === "in_progress" ? (
                              <Badge tone="ember">● Live</Badge>
                            ) : status === "completed" ? (
                              <Badge>✓ Done</Badge>
                            ) : (
                              <Badge tone={s.isPrivate ? "ember" : "neutral"}>
                                {s.isPrivate ? "Private" : "Group"}
                              </Badge>
                            )}
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
