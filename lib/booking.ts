import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { asAddressDetails, fromDetails, type StructuredAddress } from "@/lib/address";

export type BrowseSession = {
  id: string;
  classId: string;
  starts_at: string;
  ends_at: string;
  classTitle: string;
  level: string;
  durationMinutes: number;
  capacity: number;
  confirmed: number;
  /** Active bookings the current household holds for this session (one per player). */
  myBookings: { id: string; status: "confirmed" | "waitlisted"; playerId: string | null }[];
  venue: { id: string; name: string; postcode: string; lat: number; lng: number };
  coachName: string | null;
};

/** Sessions for the browse screen with live seat counts. */
export async function getBrowseSessions(
  supabase: SupabaseClient<Database>,
  clientId: string,
  days = 14
): Promise<BrowseSession[]> {
  const until = new Date(Date.now() + days * 86400000).toISOString();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,ends_at,capacity_override,coach_id,classes!inner(id,title,skill_level,capacity,duration_minutes,class_type,venues!inner(id,name,postcode,lat,lng))"
    )
    .eq("status", "scheduled")
    .eq("classes.class_type", "group")
    .gt("starts_at", new Date().toISOString())
    .lt("starts_at", until)
    .order("starts_at");

  if (!sessions || sessions.length === 0) return [];

  const ids = sessions.map((s) => s.id);
  const [{ data: bookingRows }, { data: myBookingRows }, coachNames] = await Promise.all([
    supabase
      .from("bookings")
      .select("session_id")
      .in("session_id", ids)
      .eq("status", "confirmed"),
    supabase
      .from("bookings")
      .select("id,session_id,status,player_id")
      .in("session_id", ids)
      .eq("client_id", clientId)
      .in("status", ["confirmed", "waitlisted"]),
    getCoachNames(
      supabase,
      sessions.map((s) => s.coach_id).filter((id): id is string => !!id)
    ),
  ]);

  const counts = new Map<string, number>();
  for (const row of bookingRows ?? []) {
    counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
  }

  const myBookings = new Map<
    string,
    { id: string; status: "confirmed" | "waitlisted"; playerId: string | null }[]
  >();
  for (const row of myBookingRows ?? []) {
    const entry = myBookings.get(row.session_id) ?? [];
    entry.push({
      id: row.id,
      status: row.status as "confirmed" | "waitlisted",
      playerId: row.player_id ?? null,
    });
    myBookings.set(row.session_id, entry);
  }

  return sessions.map((s) => {
    const cls = s.classes;
    return {
      id: s.id,
      classId: cls.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      classTitle: cls.title,
      level: cls.skill_level,
      durationMinutes: cls.duration_minutes,
      capacity: s.capacity_override ?? cls.capacity,
      confirmed: counts.get(s.id) ?? 0,
      myBookings: myBookings.get(s.id) ?? [],
      venue: cls.venues,
      coachName: s.coach_id ? (coachNames.get(s.coach_id) ?? null) : null,
    };
  });
}

async function getCoachNames(supabase: SupabaseClient<Database>, ids: string[]) {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from("profiles")
    .select("id,full_name")
    .in("id", [...new Set(ids)]);
  for (const row of data ?? []) map.set(row.id, row.full_name);
  return map;
}

export type MyBooking = {
  id: string;
  status: string;
  waitlist_position: number | null;
  seriesId: string | null;
  /** Standing weekly private slot this booking belongs to, if any. */
  privateSeriesId: string | null;
  playerId: string | null;
  playerName: string;
  session: {
    id: string;
    starts_at: string;
    ends_at: string;
    classTitle: string;
    isPrivate: boolean;
    venueName: string | null;
    coachName: string | null;
    address: StructuredAddress | null;
  };
};

/** Statuses that still put a client in the room — the rest is history. */
const LIVE_STATUSES = new Set(["confirmed", "waitlisted"]);

const startMs = (b: MyBooking) => new Date(b.session.starts_at).getTime();

/** A booking the client is still expected at: live status, and yet to start. */
export function isUpcoming(booking: MyBooking, now: number): boolean {
  return LIVE_STATUSES.has(booking.status) && startMs(booking) > now;
}

/**
 * Split what `getMyBookings` returned into the Upcoming and Past tabs.
 *
 * The two halves are a *partition*: `past` is everything `upcoming` didn't take,
 * so every booking fetched is on screen somewhere. The screens used to ask two
 * independent questions instead — "live and future?" for one tab, "already
 * started?" for the other — which left a booking marked attended ahead of its
 * start time (a coach marking the register early) matching neither, and it
 * vanished from the client's schedule while still showing on the player profile.
 *
 * Sorting here as well as in SQL is deliberate: it is what makes the Past tab
 * read newest-first rather than inheriting the query's ascending order, and it
 * keeps `upcoming[0]` an honest "next session" for callers that take the head.
 */
export function splitBookings(
  bookings: MyBooking[],
  now: number
): { upcoming: MyBooking[]; past: MyBooking[] } {
  const upcoming: MyBooking[] = [];
  const past: MyBooking[] = [];
  for (const b of bookings) (isUpcoming(b, now) ? upcoming : past).push(b);
  upcoming.sort((a, b) => startMs(a) - startMs(b));
  past.sort((a, b) => startMs(b) - startMs(a));
  return { upcoming, past };
}

export async function getMyBookings(
  supabase: SupabaseClient<Database>,
  clientId: string
): Promise<MyBooking[]> {
  const { data } = await supabase
    .from("bookings")
    .select(
      "id,status,waitlist_position,series_id,private_series_id,players(id,full_name),class_sessions!inner(id,starts_at,ends_at,coach_id,classes!inner(title,class_type,location_label,venues(name,address,postcode,lat,lng,address_details),private_class_details(address,postcode,lat,lng,address_details)))"
    )
    .eq("client_id", clientId)
    .in("status", ["confirmed", "waitlisted", "attended", "no_show"])
    // Order the BOOKINGS by their session's start, not the embedded session by
    // its own. `{ referencedTable }` spells the latter: it sorts rows *within* a
    // to-many embed, so on a to-one embed like this one it is a silent no-op and
    // the bookings came back in whatever order Postgres happened to read them —
    // a client with weekly slots saw 10, 17, 24, 31 Aug and then back to 11 Aug.
    // `class_sessions(starts_at)` is the top-level form and does sort the rows.
    .order("class_sessions(starts_at)", { ascending: true });

  if (!data) return [];

  const coachIds = data
    .map((b) => b.class_sessions.coach_id)
    .filter((id): id is string => !!id);
  const coachNames = await getCoachNames(supabase, coachIds);

  return data.map((b) => {
    const s = b.class_sessions;
    const v = s.classes.venues;
    const priv = s.classes.private_class_details;
    const address = v
      ? fromDetails(asAddressDetails(v.address_details), {
          address: v.address,
          postcode: v.postcode,
          lat: v.lat,
          lng: v.lng,
        })
      : priv
        ? fromDetails(asAddressDetails(priv.address_details), {
            address: priv.address,
            postcode: priv.postcode,
            lat: priv.lat,
            lng: priv.lng,
          })
        : null;
    return {
      id: b.id,
      status: b.status,
      waitlist_position: b.waitlist_position,
      seriesId: b.series_id,
      privateSeriesId: b.private_series_id,
      playerId: b.players?.id ?? null,
      playerName: b.players?.full_name ?? "",
      session: {
        id: s.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        classTitle: s.classes.title,
        isPrivate: s.classes.class_type === "private",
        venueName: s.classes.location_label ?? null,
        coachName: s.coach_id ? (coachNames.get(s.coach_id) ?? null) : null,
        address,
      },
    };
  });
}
