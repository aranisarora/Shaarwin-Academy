// Venue CRUD cores — shared by the admin actions and the WhatsApp bot.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpResult } from "@/lib/admin-ops-types";
import type { StructuredAddress } from "@/lib/address";

export type VenueInput = {
  id?: string;
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  details?: StructuredAddress | null;
};

export async function saveVenueCore(
  supabase: SupabaseClient,
  founderId: string,
  input: VenueInput
): Promise<OpResult> {
  if (!input.name.trim() || !input.address.trim()) {
    return { ok: false, error: "Venue needs a name and address." };
  }
  const row = {
    name: input.name,
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
  supabase: SupabaseClient,
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
  supabase: SupabaseClient,
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
