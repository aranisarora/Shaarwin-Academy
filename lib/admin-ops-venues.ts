// Venue CRUD cores — shared by the admin actions and the WhatsApp bot.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { OpResult } from "@/lib/admin-ops-types";
import type { StructuredAddress } from "@/lib/address";

export type VenueInput = {
  id?: string;
  name: string;
  /** Which part of a complex this is — "Villas", "Apartments", "Lakefront". */
  unit?: string | null;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  details?: StructuredAddress | null;
};

export async function saveVenueCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  input: VenueInput
): Promise<OpResult> {
  if (!input.name.trim() || !input.address.trim()) {
    return { ok: false, error: "Venue needs a name and address." };
  }

  // Two venues sharing a name must each say which part of the complex they are.
  // Within one complex the parts can be mutually inaccessible — a resident of
  // the villas can't get into the towers' clubhouse — so "Adarsh Palm Retreat,
  // Clubhouse" would send a coach to a gate that won't open. Requiring the unit
  // here is what makes an ambiguous label unconstructible downstream.
  if (!input.unit?.trim()) {
    const { data: clash } = await supabase
      .from("venues")
      .select("id,name,unit")
      .ilike("name", input.name.trim())
      .neq("id", input.id ?? "00000000-0000-0000-0000-000000000000")
      .limit(1);
    if (clash && clash.length > 0) {
      return {
        ok: false,
        error: `Another venue is already called "${input.name.trim()}". Add which part this one is (Villas, Apartments, Clubhouse…) so coaches know which entrance to use.`,
      };
    }
  }

  const row = {
    name: input.name,
    unit: input.unit?.trim() || null,
    address: input.address,
    postcode: input.postcode,
    lat: input.lat,
    lng: input.lng,
    photo_url: "/images/venue-hall.jpg",
    // Only touch the structured column when the caller supplies it, so a bare
    // update (e.g. the WhatsApp tool) doesn't wipe backfilled details.
    ...(input.details !== undefined ? { address_details: input.details } : {}),
  };
  const { error } = input.id
    ? await supabase.from("venues").update(row).eq("id", input.id)
    : await supabase.from("venues").insert(row);
  if (error) return { ok: false, error: "Couldn't save the venue." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: input.id ? "venue.update" : "venue.create",
    entity: "venues",
    entity_id: input.id ?? null,
    meta: { name: input.name },
  });
  return { ok: true };
}

export async function setVenueActiveCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  venueId: string,
  active: boolean
): Promise<OpResult> {
  const { error } = await supabase.from("venues").update({ active }).eq("id", venueId);
  if (error) return { ok: false, error: "Couldn't update the venue." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: active ? "venue.activate" : "venue.hide",
    entity: "venues",
    entity_id: venueId,
  });
  return { ok: true };
}

export async function deleteVenueCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  venueId: string
): Promise<OpResult> {
  const { count } = await supabase
    .from("classes")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error:
        "This venue has classes attached, so it can't be deleted. Hide it instead — nothing gets lost.",
    };
  }
  const { error } = await supabase.from("venues").delete().eq("id", venueId);
  if (error) return { ok: false, error: "Couldn't delete the venue." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "venue.delete",
    entity: "venues",
    entity_id: venueId,
  });
  return { ok: true };
}
