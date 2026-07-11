// Coach lifecycle cores — promote, edit details, activate/pause. Shared by the
// admin actions and the WhatsApp bot; RLS enforces on the caller's client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/whatsapp/phone";
import type { OpResult } from "@/lib/admin-ops-types";

const BENGALURU = { lat: 12.9716, lng: 77.5946 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The full set of details an admin enters when adding or editing a coach. */
export type CoachDetails = {
  fullName: string;
  email: string;
  phone: string;
  bio: string;
  tier: number;
  travelRadiusKm: number;
  baseAddress: string;
  baseLat: number;
  baseLng: number;
};

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
  baseAddress: string;
  baseLat: number;
  baseLng: number;
  tier: number;
  // Optional identity fields — when present, the coach's profile is updated too.
  fullName?: string;
  phone?: string;
};

export async function saveCoachCore(
  supabase: SupabaseClient,
  founderId: string,
  input: CoachInput
): Promise<OpResult> {
  if (!Number.isFinite(input.travelRadiusKm) || input.travelRadiusKm <= 0) {
    return { ok: false, error: "Travel distance must be a positive number." };
  }
  if (input.fullName != null && !input.fullName.trim()) {
    return { ok: false, error: "Name can't be empty." };
  }
  const { error } = await supabase
    .from("coaches")
    .update({
      bio: input.bio || null,
      travel_radius_km: input.travelRadiusKm,
      base_address: input.baseAddress || null,
      base_lat: input.baseLat,
      base_lng: input.baseLng,
      tier: input.tier,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: "Couldn't save the coach." };

  if (input.fullName != null || input.phone != null) {
    const patch: Record<string, unknown> = {};
    if (input.fullName != null) patch.full_name = input.fullName.trim();
    if (input.phone != null) patch.phone = input.phone.trim() ? normalizePhone(input.phone) : null;
    const { error: profErr } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", input.id)
      .eq("role", "coach");
    if (profErr) return { ok: false, error: "Couldn't save the coach's details." };
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.update",
    entity: "coaches",
    entity_id: input.id,
  });
  return { ok: true };
}

/**
 * Add a coach from admin-entered details. If an account already exists for the
 * email, promote it now and apply the details; otherwise register an allowlist
 * invite so the account is provisioned as a coach the moment they sign up.
 */
export async function addCoachCore(
  supabase: SupabaseClient,
  founderId: string,
  d: CoachDetails
): Promise<OpResult & { pending?: boolean }> {
  const email = d.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email doesn't look valid." };
  if (!d.fullName.trim()) return { ok: false, error: "Enter the coach's name." };
  if (!Number.isFinite(d.travelRadiusKm) || d.travelRadiusKm <= 0) {
    return { ok: false, error: "Travel distance must be a positive number." };
  }
  const phone = d.phone.trim() ? normalizePhone(d.phone) : null;

  // Already an account? Promote (if needed) and apply the entered details.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id,role")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    if (existing.role === "founder") return { ok: false, error: "That's a founder account." };
    if (existing.role !== "coach") {
      const promo = await promoteToCoachCore(supabase, founderId, existing.id);
      if (!promo.ok) return promo;
    }
    const saved = await saveCoachCore(supabase, founderId, {
      id: existing.id,
      bio: d.bio,
      travelRadiusKm: d.travelRadiusKm,
      baseAddress: d.baseAddress,
      baseLat: d.baseLat,
      baseLng: d.baseLng,
      tier: d.tier,
      fullName: d.fullName,
      phone: d.phone,
    });
    if (!saved.ok) return saved;
    return { ok: true };
  }

  // No account yet — register (or refresh) an allowlist invite.
  const { error } = await supabase.from("coach_invites").upsert(
    {
      email,
      full_name: d.fullName.trim(),
      phone,
      bio: d.bio || null,
      tier: d.tier,
      travel_radius_km: d.travelRadiusKm,
      base_address: d.baseAddress || null,
      base_lat: d.baseLat || null,
      base_lng: d.baseLng || null,
      created_by: founderId,
      claimed_at: null,
      claimed_by: null,
    },
    { onConflict: "email" }
  );
  if (error) return { ok: false, error: "Couldn't save the invite." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.invite",
    entity: "coach_invites",
    meta: { email, name: d.fullName.trim() },
  });
  return { ok: true, pending: true };
}

/** Edit a not-yet-claimed invite. */
export async function savePendingCoachCore(
  supabase: SupabaseClient,
  founderId: string,
  id: string,
  d: CoachDetails
): Promise<OpResult> {
  const email = d.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email doesn't look valid." };
  if (!d.fullName.trim()) return { ok: false, error: "Enter the coach's name." };
  if (!Number.isFinite(d.travelRadiusKm) || d.travelRadiusKm <= 0) {
    return { ok: false, error: "Travel distance must be a positive number." };
  }
  const phone = d.phone.trim() ? normalizePhone(d.phone) : null;
  const { error } = await supabase
    .from("coach_invites")
    .update({
      email,
      full_name: d.fullName.trim(),
      phone,
      bio: d.bio || null,
      tier: d.tier,
      travel_radius_km: d.travelRadiusKm,
      base_address: d.baseAddress || null,
      base_lat: d.baseLat || null,
      base_lng: d.baseLng || null,
    })
    .eq("id", id)
    .is("claimed_at", null);
  if (error) return { ok: false, error: "Couldn't save the invite." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.invite_update",
    entity: "coach_invites",
    entity_id: id,
  });
  return { ok: true };
}

/** Revoke a not-yet-claimed invite. */
export async function deletePendingCoachCore(
  supabase: SupabaseClient,
  founderId: string,
  id: string
): Promise<OpResult> {
  const { error } = await supabase
    .from("coach_invites")
    .delete()
    .eq("id", id)
    .is("claimed_at", null);
  if (error) return { ok: false, error: "Couldn't remove the invite." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.invite_revoke",
    entity: "coach_invites",
    entity_id: id,
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
