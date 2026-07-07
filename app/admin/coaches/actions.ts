"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireFounder } from "@/lib/founder";
import { decideTimeOffCore } from "@/lib/admin-ops";

type Result = { ok: boolean; error?: string };

const BENGALURU = { lat: 12.9716, lng: 77.5946 };

/** Turn an existing client account into a coach (they keep the same login). */
export async function promoteToCoach(profileId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,role,full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "That account wasn't found." };
  if (profile.role === "coach") return { ok: false, error: "They're already a coach." };
  if (profile.role === "founder") return { ok: false, error: "That's your own account." };

  const { error: roleErr } = await supabase
    .from("profiles")
    .update({ role: "coach" })
    .eq("id", profileId);
  if (roleErr) return { ok: false, error: "Couldn't update the account." };

  // Coach row with sensible defaults — everything editable from the edit screen.
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
    body: "Sign in again to see your coach tools.",
    data: { url: "/coach" },
  });
  await supabase.from("audit_log").insert({
    actor_id: founder.id,
    action: "coach.promote",
    entity: "coaches",
    entity_id: profileId,
    meta: { name: profile.full_name },
  });

  revalidatePath("/admin/coaches");
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

export async function saveCoach(input: CoachInput): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
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
    actor_id: founder.id,
    action: "coach.update",
    entity: "coaches",
    entity_id: input.id,
  });
  revalidatePath("/admin/coaches");
  return { ok: true };
}

/** Pause = stop new assignments; existing sessions stay until reassigned. */
export async function setCoachActive(coachId: string, active: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const { error } = await supabase.from("coaches").update({ active }).eq("id", coachId);
  if (error) return { ok: false, error: "Couldn't update the coach." };
  await supabase.from("audit_log").insert({
    actor_id: founder.id,
    action: active ? "coach.activate" : "coach.pause",
    entity: "coaches",
    entity_id: coachId,
  });
  revalidatePath("/admin/coaches");
  revalidatePath("/admin/calendar");
  return { ok: true };
}

export async function decideTimeOff(
  timeOffId: string,
  approve: boolean
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "founder") return { ok: false, error: "Founder only." };

  const result = await decideTimeOffCore(supabase, user.id, timeOffId, approve);
  if (!result.ok) return result;

  revalidatePath("/admin/coaches");
  revalidatePath("/admin");
  return { ok: true };
}
