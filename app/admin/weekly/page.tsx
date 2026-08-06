import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { utcToAcademyWall } from "@/lib/academy-time";
import { venueDisplayName, withVenueAddress } from "@/lib/venue-display";
import { AdminShell } from "@/components/app/AdminShell";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { AdminWeeklyClasses } from "@/components/app/AdminWeeklyClasses";
import type {
  ClassRow,
  ClientOption,
  InviteOption,
  PrivateSeriesRow,
} from "@/components/app/admin-calendar-types";
import { WEEKDAYS } from "@/components/app/admin-calendar-types";

const ISO_WEEKDAY_CODE = WEEKDAYS.map(([code]) => code); // 0-based: [MO..SU]

/** "Monday 3:30 pm · Mantri Espana" → "15:30".
 *
 * Last resort, for a class that never had a single session generated. The title
 * is written from the slot by `generateClassTitle`, so it is the only record of
 * that slot left once there are no sessions to read it off — `recurrence_rule`
 * carries the day and nothing else. Anything unparseable falls through. */
function timeFromTitle(title: string): string | null {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(title);
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export const metadata: Metadata = { title: "Weekly classes" };

type SearchParams = Promise<{ class?: string }>;

// The repeating classes behind the schedule — create, edit, pause and end
// them here. The Schedule tab shows the sessions they generate.
async function Weekly({ searchParams }: { searchParams: SearchParams }) {
  const [{ supabase }, { class: openClassId }] = await Promise.all([
    requireUser("/admin/weekly"),
    searchParams,
  ]);

  const [
    { data: classes },
    { count: oneOffCount },
    { data: coaches },
    { data: venues },
    { data: clients },
    { data: invites },
    { data: series },
  ] = await Promise.all([
    supabase
      .from("classes")
      .select(
        "id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,ends_on,venue_id,is_school,venues(name,unit)"
      )
      .eq("class_type", "group")
      .not("recurrence_rule", "is", null)
      .order("title"),
    // A group class with no recurrence rule runs on a date, not on a weekday.
    // This screen is the repeating pattern — every card on it says "Every Mon",
    // every edit here means "for every week", and the removal sheet's whole
    // vocabulary (end it, restore it, it stays on this list under Ended) is
    // about a class that has weeks. A one-off has one hour and then it is
    // history, so it belongs on the Schedule and it stays excluded.
    //
    // What was wrong was doing that in silence. Seven of them exist on prod at
    // the last count, two holding real attendance (twelve marked registers on
    // one, eight on another), and the founder had no way of knowing from this
    // screen that they were anywhere — so we count them and say where they are.
    // (Only the count crosses over: the rows themselves would have to be given
    // a fake weekday to render here, which is exactly the pretence we're
    // dropping.)
    supabase
      .from("classes")
      .select("id", { count: "exact", head: true })
      .eq("class_type", "group")
      .is("recurrence_rule", null),
    supabase
      .from("coaches")
      .select("id,active,profiles!inner(full_name)")
      .eq("active", true),
    supabase.from("venues").select("id,name,unit,active,address,postcode,lat,lng,address_details").order("name"),
    supabase
      .from("profiles")
      .select("id,full_name,players(id,full_name)")
      .eq("role", "client")
      .order("full_name"),
    supabase
      .from("client_invites")
      .select("id,phone,full_name")
      .is("claimed_at", null)
      .order("created_at", { ascending: false }),
    // Active client weekly privates — grouped alongside group classes by
    // resolved location. Names come from the player + owning-client joins.
    supabase
      .from("private_booking_series")
      .select(
        "id,weekday,start_time,duration_minutes,address,lat,lng,address_details,preferred_coach," +
          "venue_id,venue_label,unit_label,venues(name,unit)," +
          "player:players!private_booking_series_player_id_fkey(full_name)," +
          "client:profiles!private_booking_series_client_id_fkey(full_name)"
      )
      .eq("active", true),
  ]);

  // Each class's canonical slot time = its next scheduled session's wall time,
  // and the coach we show is whoever is on that same next session.
  const classIds = (classes ?? []).map((c) => c.id);
  const { data: nextSessions } = classIds.length
    ? await supabase
        .from("class_sessions")
        .select("id,class_id,starts_at,coach_id,coaches(profiles!inner(full_name))")
        .in("class_id", classIds)
        .eq("status", "scheduled")
        .gt("starts_at", new Date().toISOString())
        .order("starts_at")
    : {
        data: [] as {
          id: string;
          class_id: string;
          starts_at: string;
          coach_id: string | null;
          coaches: unknown;
        }[],
      };

  const nextByClass = new Map<
    string,
    { sessionId: string; starts_at: string; coachName: string | null; coachId: string | null }
  >();
  for (const s of nextSessions ?? []) {
    if (nextByClass.has(s.class_id)) continue;
    const coachName =
      (s.coaches as unknown as { profiles: { full_name: string } } | null)?.profiles?.full_name ??
      null;
    nextByClass.set(s.class_id, {
      sessionId: s.id,
      starts_at: s.starts_at,
      coachName,
      coachId: s.coach_id,
    });
  }

  // Ending a class cancels every future session, so the lookup above finds
  // nothing for one and the slot falls through. It used to fall through to a
  // hardcoded "18:30", which was not a display quirk: every ended class read as
  // 6:30 pm, sorted into the wrong evening, and — the real damage — the editor
  // seeds its form from this time and regenerates the title from it, so opening
  // an ended class to restore it and tapping Save rewrote its actual recurrence
  // and title to 6:30 pm. Its own sessions still hold the truth whether they
  // were cancelled or not, so we ask the most recent one.
  const slotlessIds = classIds.filter((id) => !nextByClass.has(id));
  const lastSessionsPromise = slotlessIds.length
    ? supabase
        .from("class_sessions")
        .select("class_id,starts_at")
        .in("class_id", slotlessIds)
        .order("starts_at", { ascending: false })
        .then((r) => r.data)
    : Promise.resolve(null);

  // The private-series booking lookup only needs `series` from the Promise.all
  // above, so start it here rather than at its use site further down — calling
  // .then() is what actually dispatches a Supabase builder, letting it overlap
  // the class-bookings query below instead of costing a second serial round
  // trip to Tokyo.
  const seriesIds = ((series ?? []) as unknown as { id: string }[]).map((s) => s.id);
  const seriesBookingsPromise = seriesIds.length
    ? supabase
        .from("bookings")
        .select("private_series_id,class_sessions(id,starts_at,status)")
        .in("private_series_id", seriesIds)
        .then((r) => r.data)
    : Promise.resolve(null);

  // How full each class's next session is — one grouped count over the next
  // session of every class, so the card can show "6 of 10 booked".
  const nextSessionIds = [...nextByClass.values()].map((n) => n.sessionId);
  const bookedBySession = new Map<string, number>();
  if (nextSessionIds.length) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("session_id")
      .in("session_id", nextSessionIds)
      .in("status", ["confirmed", "attended"]);
    for (const b of bookings ?? [])
      bookedBySession.set(b.session_id, (bookedBySession.get(b.session_id) ?? 0) + 1);
  }

  const lastByClass = new Map<string, string>();
  for (const s of (await lastSessionsPromise) ?? []) {
    if (!lastByClass.has(s.class_id)) lastByClass.set(s.class_id, s.starts_at);
  }

  const classRows: ClassRow[] = (classes ?? []).map((c) => {
    const next = nextByClass.get(c.id);
    const last = lastByClass.get(c.id);
    const time = next
      ? utcToAcademyWall(new Date(next.starts_at)).time
      : last
        ? utcToAcademyWall(new Date(last)).time
        : (timeFromTitle(c.title) ?? "18:30");
    return {
      id: c.id,
      title: c.title,
      description: c.description ?? "",
      level: c.skill_level,
      capacity: c.capacity,
      duration: c.duration_minutes,
      weekday: c.recurrence_rule?.match(/BYDAY=(..)/)?.[1] ?? "MO",
      time,
      active: c.active,
      endsOn: c.ends_on,
      venueId: c.venue_id,
      venueName: (() => {
        const v = c.venues as unknown as { name: string; unit: string | null } | null;
        return v ? venueDisplayName(v) : null;
      })(),
      isSchool: c.is_school,
      coachName: next?.coachName ?? null,
      bookedCount: next ? (bookedBySession.get(next.sessionId) ?? 0) : 0,
      nextSessionId: next?.sessionId ?? null,
      nextSessionStart: next?.starts_at ?? null,
      nextCoachId: next?.coachId ?? null,
    };
  });

  const coachList = (coaches ?? []).map((c) => ({
    id: c.id,
    name: (c.profiles as unknown as { full_name: string }).full_name,
  }));
  const coachNameById = new Map(coachList.map((c) => [c.id, c.name]));

  // The FK-hinted embeds above don't resolve through the generated types, so
  // narrow the rows to the shape we selected.
  type SeriesRow = {
    id: string;
    weekday: number;
    start_time: string;
    duration_minutes: number;
    address: string;
    lat: number;
    lng: number;
    address_details: { name?: string | null } | null;
    preferred_coach: string | null;
    venue_id: string | null;
    venue_label: string | null;
    unit_label: string | null;
    venues: { name: string; unit: string | null } | null;
    player: { full_name: string } | null;
    client: { full_name: string } | null;
  };
  const seriesRows = (series ?? []) as unknown as SeriesRow[];

  // Each series' next generated session (for the deep-link): sessions link to a
  // series through their booking's private_series_id, so find the earliest
  // scheduled future session across those bookings.
  const nextBySeriesId = new Map<string, { id: string; starts_at: string }>();
  {
    const seriesBookings = await seriesBookingsPromise;
    const nowIso = new Date().toISOString();
    for (const b of seriesBookings ?? []) {
      const sid = b.private_series_id as string | null;
      const cs = b.class_sessions as unknown as {
        id: string;
        starts_at: string;
        status: string;
      } | null;
      if (!sid || !cs || cs.status !== "scheduled" || cs.starts_at <= nowIso) continue;
      const cur = nextBySeriesId.get(sid);
      if (!cur || cs.starts_at < cur.starts_at)
        nextBySeriesId.set(sid, { id: cs.id, starts_at: cs.starts_at });
    }
  }

  // A series stores its own location (migration 0054) — the same venue_id the
  // booking picker set, so it nests under that venue's group here and the
  // nightly generator materialises every future week with the same label.
  // Only a location we hold no venue row for falls back to venue_label.
  const knownVenueNames = new Set(
    (venues ?? []).map((v) => venueDisplayName(v).toLowerCase())
  );

  const privateSeriesRows: PrivateSeriesRow[] = seriesRows.map((s) => {
    const venueName =
      (s.venues ? venueDisplayName(s.venues) : s.venue_label?.trim()) ??
      "Private location";
    const next = nextBySeriesId.get(s.id);
    return {
      id: s.id,
      playerName: s.player?.full_name ?? "Player",
      clientName: s.client?.full_name ?? "",
      weekday: ISO_WEEKDAY_CODE[s.weekday - 1] ?? "MO",
      time: String(s.start_time).slice(0, 5),
      duration: s.duration_minutes,
      coachName: s.preferred_coach
        ? coachNameById.get(s.preferred_coach) ?? null
        : null,
      venueName,
      knownVenue: knownVenueNames.has(venueName.toLowerCase()),
      nextSessionId: next?.id ?? null,
      nextSessionStart: next?.starts_at ?? null,
    };
  });

  const clientRows: ClientOption[] = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.full_name,
    players: ((c.players as { id: string; full_name: string }[]) ?? []).map((p) => ({
      id: p.id,
      name: p.full_name,
    })),
  }));

  const inviteRows: InviteOption[] = (invites ?? []).map((i) => ({
    id: i.id,
    name: (i.full_name ?? "").trim(),
    phone: i.phone,
  }));

  return (
    <AdminWeeklyClasses
      classes={classRows}
      privateSeries={privateSeriesRows}
      oneOffCount={oneOffCount ?? 0}
      coaches={coachList}
      venues={withVenueAddress(venues)}
      clients={clientRows}
      invites={inviteRows}
      openClassId={openClassId ?? null}
    />
  );
}

export default function AdminWeeklyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <AdminShell title="Weekly classes">
      <Suspense fallback={<PageSkeleton />}>
        <Weekly searchParams={searchParams} />
      </Suspense>
    </AdminShell>
  );
}
