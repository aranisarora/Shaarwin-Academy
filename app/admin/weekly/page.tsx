import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { utcToAcademyWall } from "@/lib/academy-time";
import { makeVenueResolver } from "@/lib/venue-display";
import { AdminShell } from "@/components/app/AdminShell";
import { AdminWeeklyClasses } from "@/components/app/AdminWeeklyClasses";
import type {
  ClassRow,
  ClientOption,
  InviteOption,
  PrivateSeriesRow,
} from "@/components/app/admin-calendar-types";
import { WEEKDAYS } from "@/components/app/admin-calendar-types";

const ISO_WEEKDAY_CODE = WEEKDAYS.map(([code]) => code); // 0-based: [MO..SU]

export const metadata: Metadata = { title: "Weekly classes" };

// The repeating classes behind the schedule — create, edit, pause and end
// them here. The Schedule tab shows the sessions they generate.
export default async function AdminWeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}) {
  const { supabase } = await requireUser("/admin/weekly");
  const { class: openClassId } = await searchParams;

  const [
    { data: classes },
    { data: coaches },
    { data: venues },
    { data: clients },
    { data: invites },
    { data: series },
  ] = await Promise.all([
    supabase
      .from("classes")
      .select(
        "id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,ends_on,venue_id,is_school,venues(name)"
      )
      .eq("class_type", "group")
      .not("recurrence_rule", "is", null)
      .order("title"),
    supabase
      .from("coaches")
      .select("id,active,profiles!inner(full_name)")
      .eq("active", true),
    supabase.from("venues").select("id,name,active,address,postcode,lat,lng,address_details").order("name"),
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

  const classRows: ClassRow[] = (classes ?? []).map((c) => {
    const next = nextByClass.get(c.id);
    return {
      id: c.id,
      title: c.title,
      description: c.description ?? "",
      level: c.skill_level,
      capacity: c.capacity,
      duration: c.duration_minutes,
      weekday: c.recurrence_rule?.match(/BYDAY=(..)/)?.[1] ?? "MO",
      time: next ? utcToAcademyWall(new Date(next.starts_at)).time : "18:30",
      active: c.active,
      endsOn: c.ends_on,
      venueId: c.venue_id,
      venueName: (c.venues as unknown as { name: string } | null)?.name ?? null,
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
    player: { full_name: string } | null;
    client: { full_name: string } | null;
  };
  const seriesRows = (series ?? []) as unknown as SeriesRow[];

  // Each series' next generated session (for the deep-link): sessions link to a
  // series through their booking's private_series_id, so find the earliest
  // scheduled future session across those bookings.
  const seriesIds = seriesRows.map((s) => s.id);
  const nextBySeriesId = new Map<string, { id: string; starts_at: string }>();
  if (seriesIds.length) {
    const { data: seriesBookings } = await supabase
      .from("bookings")
      .select("private_series_id,class_sessions(id,starts_at,status)")
      .in("private_series_id", seriesIds);
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

  // Resolve each series' display location the same way every stakeholder
  // surface does — exact venue-address match, then POI name, then a venue pin
  // within ~150 m, else the client-home address. A series booked at a known
  // venue therefore nests under that venue's group; only genuine new locations
  // (client homes) spawn their own group.
  const resolveVenue = makeVenueResolver(
    (venues ?? []).map((v) => ({ name: v.name, address: v.address, lat: v.lat, lng: v.lng }))
  );
  const knownVenueNames = new Set(
    (venues ?? []).map((v) => v.name.toLowerCase())
  );

  const privateSeriesRows: PrivateSeriesRow[] = seriesRows.map((s) => {
    const venueName =
      resolveVenue({
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        address_details: s.address_details,
      }) ?? "Private location";
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
    <AdminShell title="Weekly classes">
      <AdminWeeklyClasses
        classes={classRows}
        privateSeries={privateSeriesRows}
        coaches={coachList}
        venues={venues ?? []}
        clients={clientRows}
        invites={inviteRows}
        openClassId={openClassId ?? null}
      />
    </AdminShell>
  );
}
