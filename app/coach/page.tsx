import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { getCoachSessions, type CoachSession } from "@/lib/coach-data";
import { CoachShell } from "@/components/app/CoachShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { AutoOpenSession } from "@/components/app/AutoOpenSession";
import {
  CoachScheduleDays,
  type ScheduleDay,
} from "@/components/app/CoachScheduleDays";
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
  const tomorrowKey = dayLabel(new Date(now + 86400000).toISOString());

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

  // Prepare a fully-serialisable view for the client collapse component — all
  // time/status computation stays here on the server.
  const days: ScheduleDay[] = [...byDay.entries()].map(([key, rows]) => {
    const ordered = [
      ...rows.filter((s) => sessionTimeStatus(s.starts_at, s.ends_at, now) !== "completed"),
      ...rows.filter((s) => sessionTimeStatus(s.starts_at, s.ends_at, now) === "completed"),
    ];
    const label = key === todayKey ? "Today" : key === tomorrowKey ? "Tomorrow" : key;
    return {
      key,
      label,
      isToday: key === todayKey,
      firstTime: fmtTime(rows[0].starts_at),
      sessions: ordered.map((s, i) => {
        const prev = ordered[i - 1];
        const travelGap =
          !!prev &&
          (prev.venueName ?? prev.privateAddress) !==
            (s.venueName ?? s.privateAddress);
        // Venue name for group classes; for privates, the area (POI name or
        // neighbourhood) — never the exact street, which "Open maps" covers.
        const locationName =
          s.venueName ??
          s.address?.name ??
          s.address?.locality ??
          s.address?.subLocality ??
          "Private session";
        return {
          id: s.id,
          locationName,
          timeLabel: `${fmtTime(s.starts_at)} – ${fmtTime(s.ends_at)}`,
          typeLine: classTypeLine(s),
          status: sessionTimeStatus(s.starts_at, s.ends_at, now),
          featured: s.id === featuredId,
          travelGap,
          isPrivate: s.isPrivate,
          confirmed: s.confirmed,
          capacity: s.capacity,
          lat: s.lat,
          lng: s.lng,
        };
      }),
    };
  });

  return (
    <CoachShell title="Schedule">
      {liveSession && <AutoOpenSession sessionId={liveSession.id} />}
      {sessions.length === 0 ? (
        <div className="mx-auto max-w-2xl">
          <EmptyState
            image="/images/empty-ivory.jpg"
            copy="Nothing scheduled in the next four weeks."
          />
        </div>
      ) : (
        <CoachScheduleDays days={days} />
      )}
    </CoachShell>
  );
}
