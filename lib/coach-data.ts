import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { asAddressDetails, fromDetails, type StructuredAddress } from "@/lib/address";

export type CoachSession = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  classTitle: string;
  isPrivate: boolean;
  // A group class held at a school: nobody books it online, the coach adds the
  // pupils who turn up. The admin app has told private, school and group apart
  // since the kind system landed; the coach's schedule never selected the flag,
  // so a school block arrived on his phone labelled "Group class" — the one
  // kind where he, not a parent, is responsible for the register.
  isSchool: boolean;
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
      "id,starts_at,ends_at,status,capacity_override,classes!inner(id,title,skill_level,capacity,class_type,is_school,location_label,venues(name,address,postcode,lat,lng,address_details),private_class_details(address,postcode,lat,lng,access_notes,address_details,profiles!client_id(full_name))),bookings(status)"
    )
    .eq("coach_id", coachId)
    .in("bookings.status", ["confirmed", "attended", "no_show"])
    .in("status", ["scheduled", "completed"])
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at");

  return (sessions ?? []).map((s) => {
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
      isSchool: !!cls.is_school,
      level: cls.skill_level,
      capacity: s.capacity_override ?? cls.capacity,
      confirmed: s.bookings.length,
      playerName: priv?.profiles?.full_name ?? null,
      // The same string the coach's WhatsApp reminder carries: location_label
      // is a computed field over public.location_label(classes), so the card
      // and the message can't drift apart.
      venueName: cls.location_label ?? null,
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
