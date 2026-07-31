import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { getCoachSessions, type CoachSession } from "@/lib/coach-data";
import { CoachShell } from "@/components/app/CoachShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { AutoOpenSession } from "@/components/app/AutoOpenSession";
import { CoachActionSheet, type CoachAction } from "@/components/app/CoachActionSheet";
import {
  CoachScheduleDays,
  type ScheduleDay,
} from "@/components/app/CoachScheduleDays";
import {
  formatClock,
  formatDayLong,
  nowMs,
  sessionTimeStatus,
} from "@/lib/academy-time";
import { makeVenueResolver, type PrivLocation } from "@/lib/venue-display";

export const metadata: Metadata = { title: "Schedule" };

// Doubles as the day-grouping key: "Saturday 12 July" is unique per day.
const dayLabel = formatDayLong;

/** Card's third line: the client's name for a private, else "Group class". */
function classTypeLine(s: CoachSession): string {
  if (s.isPrivate) return s.playerName ?? "Private session";
  return "Group class";
}

type ActionRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  coach_confirmed_at: string | null;
  coach_arrived_at: string | null;
  classes: unknown;
};

type VenueEmbed = { name: string; lat: number | null; lng: number | null };
type PrivEmbed = {
  address: string | null;
  lat: number | null;
  lng: number | null;
  address_details: unknown;
};

/** The one action to surface in the takeover sheet, or null. Rows are ordered by
 *  starts_at, so `find` returns the soonest match. Arrive (in-window, unmarked)
 *  outranks a coming-check (within 12h, neither confirmed nor arrived). */
function pickCoachAction(
  rows: ActionRow[],
  now: number,
  todayKey: string,
  tomorrowKey: string,
  resolveVenueName: (priv: PrivLocation) => string | null
): CoachAction | null {
  const toAction = (r: ActionRow, phase: "confirm" | "arrive"): CoachAction => {
    const cls = r.classes as {
      title?: string;
      venues?: VenueEmbed | VenueEmbed[] | null;
      private_class_details?: PrivEmbed | PrivEmbed[] | null;
    };
    const venue = Array.isArray(cls.venues) ? cls.venues[0] : cls.venues;
    const priv = Array.isArray(cls.private_class_details)
      ? cls.private_class_details[0]
      : cls.private_class_details;
    const dk = dayLabel(r.starts_at);
    const dayName = dk === todayKey ? "Today" : dk === tomorrowKey ? "Tomorrow" : dk;
    return {
      sessionId: r.id,
      title: cls.title ?? "Session",
      whenLabel: `${dayName} · ${formatClock(r.starts_at)}`,
      // A private used to leave this null, so the sheet that tells a coach where
      // to go named no place at all. Resolve it the way the schedule cards below
      // and the admin surfaces already do, rather than inventing a third answer.
      venueName: venue?.name ?? (priv ? resolveVenueName(priv) : null),
      phase,
      venueLat: venue?.lat ?? priv?.lat ?? null,
      venueLng: venue?.lng ?? priv?.lng ?? null,
    };
  };

  const arrive = rows.find((r) => {
    if (r.coach_arrived_at) return false;
    const start = new Date(r.starts_at).getTime();
    const end = new Date(r.ends_at).getTime();
    return now >= start - 60 * 60000 && now <= end;
  });
  if (arrive) return toAction(arrive, "arrive");

  const confirm = rows.find(
    (r) => !r.coach_confirmed_at && !r.coach_arrived_at && new Date(r.starts_at).getTime() >= now
  );
  return confirm ? toAction(confirm, "confirm") : null;
}

/** The whole schedule, streamed so the shell paints before auth resolves. */
async function Schedule() {
  const { supabase, user } = await requireUser("/coach");
  const coachId = await effectiveCoachId(user.id);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 28 * 86400000);

  const now = nowMs();

  // The takeover-sheet query needs nothing from the schedule query — only
  // coachId and the clock, both known here — so the two overlap instead of
  // running back to back. Supabase builders are lazy; `Promise.all` awaiting
  // them is what dispatches both.
  const [sessions, { data: actRows }, { data: venues }] = await Promise.all([
    getCoachSessions(supabase, coachId, from, to),
    supabase
      .from("class_sessions")
      .select(
        "id,starts_at,ends_at,coach_confirmed_at,coach_arrived_at,classes!inner(title,venues(name,lat,lng),private_class_details(address,lat,lng,address_details))"
      )
      .eq("coach_id", coachId)
      .eq("status", "scheduled")
      .gte("starts_at", new Date(now - 3 * 3600000).toISOString())
      .lte("starts_at", new Date(now + 12 * 3600000).toISOString())
      .order("starts_at", { ascending: true }),
    supabase.from("venues").select("name,address,lat,lng").eq("active", true),
  ]);
  const resolveVenueName = makeVenueResolver(venues ?? []);

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
      firstTime: formatClock(rows[0].starts_at),
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
          timeLabel: `${formatClock(s.starts_at)} – ${formatClock(s.ends_at)}`,
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

  // The single next action to surface as a takeover sheet: an "arrived?" for a
  // session already in the window, else a "coming?" for one starting within 12h
  // that the coach has neither confirmed nor arrived. Most-urgent first.
  const coachAction = pickCoachAction(
    actRows ?? [],
    now,
    todayKey,
    tomorrowKey,
    resolveVenueName
  );

  return (
    <>
      {liveSession && <AutoOpenSession sessionId={liveSession.id} />}
      <CoachActionSheet action={coachAction} />
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
    </>
  );
}

export default function CoachSchedulePage() {
  return (
    <CoachShell title="Schedule">
      <Suspense fallback={<PageSkeleton />}>
        <Schedule />
      </Suspense>
    </CoachShell>
  );
}
