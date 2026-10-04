import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { utcToAcademyWall } from "@/lib/academy-time";
import { asAddressDetails, fromDetails } from "@/lib/address";
import type { SessionRow } from "@/components/app/admin-calendar-types";
import {
  fetchFollowThrough,
  sessionClientIds,
  NO_FOLLOW_THROUGH,
} from "@/lib/session-followthrough";

type Supabase = SupabaseClient<Database>;

export function fetchWeekRaw(supabase: Supabase, from: Date, to: Date) {
  return (
    supabase
      .from("class_sessions")
      .select(
        "id,starts_at,ends_at,status,cancel_reason,coach_id,coach_arrived_at,coach_arrival_source,coach_arrival_distance_m,capacity_override,classes!inner(id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,class_type,is_school,location_label,venues(name,address,postcode,lat,lng,address_details),private_class_details(client_id,address,postcode,lat,lng,access_notes,address_details,players(full_name),profiles!client_id(full_name)))"
      )
      // Cancelled sessions are fetched too. Leaving them out is what made a
      // called-off class vanish rather than read as cancelled, so the founder
      // could not tell "we don't run Tuesdays" from "Tuesday was called off" —
      // and had to go to a second tab to find out which.
      .in("status", ["scheduled", "completed", "cancelled"])
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at")
  );
}

type WeekRaw = NonNullable<Awaited<ReturnType<typeof fetchWeekRaw>>["data"]>;

export async function buildSessionRows(
  supabase: Supabase,
  raw: WeekRaw,
  nextByClass: Record<string, string>,
  slotByClass: Record<string, string>
): Promise<SessionRow[]> {
  const followThrough = await fetchFollowThrough(
    supabase,
    raw.map((s) => s.id)
  );

  return raw.map((s) => {
    const cls = s.classes;
    const priv = cls.private_class_details;
    const owed = followThrough.get(s.id) ?? NO_FOLLOW_THROUGH;
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
      cancelReason: s.cancel_reason,
      coachId: s.coach_id,
      coachArrivedAt: s.coach_arrived_at,
      coachArrivalSource: s.coach_arrival_source,
      coachArrivalDistanceM: s.coach_arrival_distance_m,
      rosterUnmarked: owed.rosterUnmarked,
      assessPending: owed.assessPending,
      title: cls.title,
      capacity: s.capacity_override ?? cls.capacity,
      isPrivate: cls.class_type === "private",
      isSchool: cls.is_school,
      venueName: cls.location_label ?? null,
      playerName: priv?.profiles?.full_name ?? null,
      privatePlayerName: priv?.players?.full_name ?? null,
      privateClientId: priv?.client_id ?? null,
      clientIds: sessionClientIds(owed, priv?.client_id ?? null),
      address,
      classId: cls.id,
      classActive: cls.active,
      classDescription: cls.description ?? "",
      classLevel: cls.skill_level,
      classCapacity: cls.capacity,
      classDuration: cls.duration_minutes,
      classVenueId: cls.venue_id,
      classWeekday: cls.recurrence_rule?.match(/BYDAY=(..)/)?.[1] ?? "MO",
      classTime: utcToAcademyWall(new Date(nextByClass[cls.id] ?? s.starts_at)).time,
      classSlotTime: slotByClass[cls.id] ?? null,
      classRecurring: !!cls.recurrence_rule,
    };
  });
}
