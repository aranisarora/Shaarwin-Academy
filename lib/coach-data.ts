import type { SupabaseClient } from "@supabase/supabase-js";

export type CoachSession = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  classTitle: string;
  isPrivate: boolean;
  level: string;
  capacity: number;
  confirmed: number;
  venueName: string | null;
  venueAddress: string | null;
  venuePostcode: string | null;
  privateAddress: string | null;
  privatePostcode: string | null;
  lat: number | null;
  lng: number | null;
};

export async function getCoachSessions(
  supabase: SupabaseClient,
  coachId: string,
  from: Date,
  to: Date
): Promise<CoachSession[]> {
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,ends_at,status,capacity_override,classes!inner(id,title,skill_level,capacity,class_type,venues(name,address,postcode,lat,lng),private_class_details(address,postcode,lat,lng))"
    )
    .eq("coach_id", coachId)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at");

  if (!sessions || sessions.length === 0) return [];

  const ids = sessions.map((s) => s.id);
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("session_id")
    .in("session_id", ids)
    .in("status", ["confirmed", "attended", "no_show"]);
  const counts = new Map<string, number>();
  for (const row of bookingRows ?? []) {
    counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
  }

  return sessions.map((s) => {
    const cls = s.classes as unknown as {
      title: string;
      skill_level: string;
      capacity: number;
      class_type: string;
      venues: {
        name: string;
        address: string;
        postcode: string;
        lat: number;
        lng: number;
      } | null;
      private_class_details:
        | { address: string; postcode: string; lat: number; lng: number }[]
        | null;
    };
    const priv = cls.private_class_details?.[0] ?? null;
    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      status: s.status,
      classTitle: cls.title,
      isPrivate: cls.class_type === "private",
      level: cls.skill_level,
      capacity: s.capacity_override ?? cls.capacity,
      confirmed: counts.get(s.id) ?? 0,
      venueName: cls.venues?.name ?? null,
      venueAddress: cls.venues?.address ?? null,
      venuePostcode: cls.venues?.postcode ?? null,
      privateAddress: priv?.address ?? null,
      privatePostcode: priv?.postcode ?? null,
      lat: cls.venues?.lat ?? priv?.lat ?? null,
      lng: cls.venues?.lng ?? priv?.lng ?? null,
    };
  });
}
