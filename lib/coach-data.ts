import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { asAddressDetails, fromDetails, type StructuredAddress } from "@/lib/address";
import { makeVenueResolver } from "@/lib/venue-display";

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
  playerName: string | null;
  privateAddress: string | null;
  privatePostcode: string | null;
  lat: number | null;
  lng: number | null;
  // Full structured location (venue or private), for AddressDisplay.
  address: StructuredAddress | null;
};

export async function getCoachSessions(
  supabase: SupabaseClient<Database>,
  coachId: string,
  from: Date,
  to: Date
): Promise<CoachSession[]> {
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,ends_at,status,capacity_override,classes!inner(id,title,skill_level,capacity,class_type,venues(name,address,postcode,lat,lng,address_details),private_class_details(address,postcode,lat,lng,access_notes,address_details,profiles!client_id(full_name)))"
    )
    .eq("coach_id", coachId)
    .in("status", ["scheduled", "completed"])
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at");

  if (!sessions || sessions.length === 0) return [];

  // Private classes store a raw client address, but most sit at (or near) a
  // known venue. Resolve to the venue's title so a private card shows
  // "La Palazzo" — or at least the first address segment — rather than falling
  // through to "Private session". Mirrors the admin schedule + session sheet.
  const { data: venues } = await supabase
    .from("venues")
    .select("name,address,lat,lng")
    .eq("active", true);
  const resolveVenueName = makeVenueResolver(venues ?? []);

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
    const cls = s.classes;
    const priv = cls.private_class_details;
    const address = cls.venues
      ? fromDetails(asAddressDetails(cls.venues.address_details), {
          address: cls.venues.address,
          postcode: cls.venues.postcode,
          lat: cls.venues.lat,
          lng: cls.venues.lng,
        })
      : priv
        ? fromDetails(asAddressDetails(priv.address_details), {
            address: priv.address,
            postcode: priv.postcode,
            lat: priv.lat,
            lng: priv.lng,
            access_notes: priv.access_notes,
          })
        : null;
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
      playerName: priv?.profiles?.full_name ?? null,
      venueName: cls.venues?.name ?? (priv ? resolveVenueName(priv) : null),
      venueAddress: cls.venues?.address ?? null,
      venuePostcode: cls.venues?.postcode ?? null,
      privateAddress: priv?.address ?? null,
      privatePostcode: priv?.postcode ?? null,
      lat: cls.venues?.lat ?? priv?.lat ?? null,
      lng: cls.venues?.lng ?? priv?.lng ?? null,
      address,
    };
  });
}
