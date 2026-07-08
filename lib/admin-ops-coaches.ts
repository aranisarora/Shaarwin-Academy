// Coach lifecycle cores — promote, edit details, activate/pause. Shared by the
// admin actions and the WhatsApp bot; RLS enforces on the caller's client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpResult } from "@/lib/admin-ops";

const BENGALURU = { lat: 12.9716, lng: 77.5946 };

/** Turn an existing client account into a coach (they keep the same login). */
export async function promoteToCoachCore(
  supabase: SupabaseClient,
  founderId: string,
  profileId: string
): Promise<OpResult> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id,role,full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "That account wasn't found." };
  if (profile.role === "coach") return { ok: false, error: "They're already a coach." };
  if (profile.role === "founder") return { ok: false, error: "That's a founder account." };

  const { error: roleErr } = await supabase
    .from("profiles")
    .update({ role: "coach" })
    .eq("id", profileId);
  if (roleErr) return { ok: false, error: "Couldn't update the account." };

  const { error: coachErr } = await supabase.from("coaches").upsert({
    id: profileId,
    base_lat: BENGALURU.lat,
    base_lng: BENGALURU.lng,
    travel_radius_km: 10,
    max_teachable_level: "advanced",
    dbs_checked: false,
    tier: 1,
    active: true,
  });
  if (coachErr) {
    await supabase.from("profiles").update({ role: "client" }).eq("id", profileId);
    return { ok: false, error: "Couldn't create the coach record." };
  }

  await supabase.from("notifications").insert({
    user_id: profileId,
    type: "role_changed",
    title: "You're a coach now",
    body: "Message me any time for your schedule, rosters and availability.",
    data: { url: "/coach" },
  });
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.promote",
    entity: "coaches",
    entity_id: profileId,
    meta: { name: profile.full_name },
  });
  return { ok: true };
}

export type CoachInput = {
  id: string;
  bio: string;
  travelRadiusKm: number;
  maxTeachableLevel: string;
  tier: number;
  dbsChecked: boolean;
};

export async function saveCoachCore(
  supabase: SupabaseClient,
  founderId: string,
  input: CoachInput
): Promise<OpResult> {
  if (!Number.isFinite(input.travelRadiusKm) || input.travelRadiusKm <= 0) {
    return { ok: false, error: "Travel distance must be a positive number." };
  }
  const { error } = await supabase
    .from("coaches")
    .update({
      bio: input.bio || null,
      travel_radius_km: input.travelRadiusKm,
      max_teachable_level: input.maxTeachableLevel,
      tier: input.tier,
      dbs_checked: input.dbsChecked,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: "Couldn't save the coach." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.update",
    entity: "coaches",
    entity_id: input.id,
  });
  return { ok: true };
}

/** Pause = stop new assignments; existing sessions stay until reassigned. */
export async function setCoachActiveCore(
  supabase: SupabaseClient,
  founderId: string,
  coachId: string,
  active: boolean
): Promise<OpResult> {
  const { error } = await supabase.from("coaches").update({ active }).eq("id", coachId);
  if (error) return { ok: false, error: "Couldn't update the coach." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: active ? "coach.activate" : "coach.pause",
    entity: "coaches",
    entity_id: coachId,
  });
  return { ok: true };
}
