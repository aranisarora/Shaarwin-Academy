import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDetails, type StructuredAddress } from "@/lib/address";

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
  venue: { id: string; name: string; postcode: string; lat: number; lng: number };
  coachName: string | null;
};

/** Sessions for the browse screen with live seat counts. */
export async function getBrowseSessions(
  supabase: SupabaseClient,
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
  const [{ data: bookingRows }, coachNames] = await Promise.all([
    supabase
      .from("bookings")
      .select("session_id")
      .in("session_id", ids)
      .eq("status", "confirmed"),
    getCoachNames(
      supabase,
      sessions.map((s) => s.coach_id).filter(Boolean) as string[]
    ),
  ]);

  const counts = new Map<string, number>();
  for (const row of bookingRows ?? []) {
    counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
  }

  return sessions.map((s) => {
    const cls = s.classes as unknown as {
      id: string;
      title: string;
      skill_level: string;
      capacity: number;
      duration_minutes: number;
      venues: { id: string; name: string; postcode: string; lat: number; lng: number };
    };
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
      venue: cls.venues,
      coachName: s.coach_id ? (coachNames.get(s.coach_id) ?? null) : null,
    };
  });
}

async function getCoachNames(supabase: SupabaseClient, ids: string[]) {
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

export async function getMyBookings(
  supabase: SupabaseClient,
  clientId: string
): Promise<MyBooking[]> {
  const { data } = await supabase
    .from("bookings")
    .select(
      "id,status,waitlist_position,series_id,private_series_id,players(id,full_name),class_sessions!inner(id,starts_at,ends_at,coach_id,classes!inner(title,class_type,venues(name,address,postcode,lat,lng,address_details),private_class_details(address,postcode,lat,lng,address_details)))"
    )
    .eq("client_id", clientId)
    .in("status", ["confirmed", "waitlisted", "attended", "no_show"])
    .order("starts_at", { referencedTable: "class_sessions", ascending: true });

  if (!data) return [];

  const coachIds = data
    .map((b) => (b.class_sessions as unknown as { coach_id: string | null }).coach_id)
    .filter(Boolean) as string[];
  const coachNames = await getCoachNames(supabase, coachIds);

  return data.map((b) => {
    const s = b.class_sessions as unknown as {
      id: string;
      starts_at: string;
      ends_at: string;
      coach_id: string | null;
      classes: {
        title: string;
        class_type: string;
        venues: {
          name: string;
          address: string;
          postcode: string;
          lat: number;
          lng: number;
          address_details: Partial<StructuredAddress> | null;
        } | null;
        private_class_details:
          | {
              address: string;
              postcode: string;
              lat: number;
              lng: number;
              address_details: Partial<StructuredAddress> | null;
            }[]
          | null;
      };
    };
    const v = s.classes.venues;
    const priv = s.classes.private_class_details?.[0] ?? null;
    const address = v
      ? fromDetails(v.address_details, {
          address: v.address,
          postcode: v.postcode,
          lat: v.lat,
          lng: v.lng,
        })
      : priv
        ? fromDetails(priv.address_details, {
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
      seriesId: (b as unknown as { series_id: string | null }).series_id ?? null,
      privateSeriesId:
        (b as unknown as { private_series_id: string | null }).private_series_id ?? null,
      playerId:
        (b.players as unknown as { id: string } | null)?.id ?? null,
      playerName:
        (b.players as unknown as { full_name: string } | null)?.full_name ?? "",
      session: {
        id: s.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        classTitle: s.classes.title,
        isPrivate: s.classes.class_type === "private",
        venueName: s.classes.venues?.name ?? null,
        coachName: s.coach_id ? (coachNames.get(s.coach_id) ?? null) : null,
        address,
      },
    };
  });
}
