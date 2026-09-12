"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/whatsapp/identity";
import { normalizePhoneInput } from "@/lib/whatsapp/phone";

type Result = { ok: boolean; error?: string };

type PlayerInput = {
  /** Existing players row to update; omitted for new players. */
  id?: string;
  fullName: string;
  dateOfBirth: string;
};

/** Monotonic step bump; a no-op once onboarding is complete or already past. */
async function bumpStep(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  step: number
) {
  await supabase
    .from("profiles")
    .update({ onboarding_step: step })
    .eq("id", userId)
    .is("onboarded_at", null)
    .lt("onboarding_step", step);
}

/**
 * Step 1 — who's playing: upsert the roster, drop the auto-created self-player
 * when the account holder isn't playing, advance to the WhatsApp step.
 * RLS ("own household" / "own profile") scopes every write to the caller.
 */
export async function savePlayers(input: {
  players: PlayerInput[];
  removeIds: string[];
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const players = input.players
    .map((p) => ({ ...p, fullName: p.fullName.trim() }))
    .filter((p) => p.fullName);
  if (players.length === 0) {
    return { ok: false, error: "Add at least one player." };
  }

  // Existing accounts can reach onboarding with bookings already made —
  // never remove a player who still has live bookings.
  for (const id of input.removeIds) {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("player_id", id)
      .in("status", ["confirmed", "waitlisted"]);
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: "A removed player still has bookings — cancel those first.",
      };
    }
  }

  for (const p of players) {
    // skill_level is intentionally omitted: new inserts take the DB default
    // ('beginner'); updates must not touch it so coach/admin-set values survive
    // a re-onboarding edit. Mastery has replaced skill_level on client surfaces.
    const row = {
      full_name: p.fullName,
      date_of_birth: p.dateOfBirth || null,
    };
    const { error } = p.id
      ? await supabase
          .from("players")
          .update(row)
          .eq("id", p.id)
          .eq("client_id", user.id)
      : await supabase.from("players").insert({ client_id: user.id, ...row });
    if (error) return { ok: false, error: "Couldn't save the players." };
  }

  if (input.removeIds.length > 0) {
    const { error } = await supabase
      .from("players")
      .delete()
      .in("id", input.removeIds)
      .eq("client_id", user.id);
    if (error) return { ok: false, error: "Couldn't remove a player." };
  }

  await bumpStep(supabase, user.id, 1);
  revalidatePath("/app/profile");
  return { ok: true };
}

export type ConfirmPhoneResult = Result & {
  /** An admin pre-registered this number — invite claimed on save. */
  preRegistered?: boolean;
  /** Name of the gifted plan activated by the claim, if the invite carried one. */
  planName?: string | null;
};

/**
 * Step 2 — confirm a phone number. Updating profiles.phone fires the
 * profiles_claim_client_invite trigger, which claims any pre-registration
 * invite for this number and grants its gifted plan — so pre-registered
 * clients can book immediately. profiles.phone is saved right here, so
 * WhatsApp notifications flow without waiting for a first inbound message
 * (out-of-window sends use the approved template).
 */
export async function confirmPhone(rawPhone: string): Promise<ConfirmPhoneResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const phone = normalizePhoneInput(rawPhone);
  if (!phone) {
    return { ok: false, error: "That doesn't look like a phone number — include the country code, e.g. +91." };
  }

  // profiles.phone is unique (it's how the WhatsApp bot identifies accounts);
  // pre-check for a friendly message instead of a constraint error.
  const admin = adminClient();
  const { data: taken } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .neq("id", user.id)
    .maybeSingle();
  if (taken) {
    return {
      ok: false,
      error: "That number is already on another account — use a different number, or contact the academy.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ phone })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save the number. Try again." };

  // Saving profiles.phone IS the binding: WhatsApp delivery and inbound
  // identity both read that column. Nothing further to write.

  await bumpStep(supabase, user.id, 2);

  // client_invites is founder-only under RLS, so check the claim (which the
  // trigger just performed synchronously) with the service role.
  const { data: invite } = await adminClient()
    .from("client_invites")
    .select("id, plans(name)")
    .eq("claimed_by", user.id)
    .order("claimed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (invite) {
    const plan = invite.plans as { name: string } | { name: string }[] | null;
    const planName = Array.isArray(plan) ? plan[0]?.name : plan?.name;
    return { ok: true, preRegistered: true, planName: planName ?? null };
  }

  return { ok: true };
}

/**
 * Step 2 fast-path: phone was already saved (e.g. pre-set by admin or a prior
 * session that stalled after saving but before bumping). Just advance the step
 * so finishOnboardingSetup won't block on the guard.
 */
export async function acknowledgePhoneStep(): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  await bumpStep(supabase, user.id, 2);
  return { ok: true };
}

/**
 * Step 3 — the setup steps are done; stamp onboarded_at so requireUser stops
 * routing here, then the client heads into the real booking flow.
 * (Notification prefs are all-on by default and editable in profile settings —
 * they're not an onboarding step.)
 */
export async function finishOnboardingSetup(): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_step,onboarded_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Couldn't finish setup." };
  if (!profile.onboarded_at && (profile.onboarding_step ?? 0) < 2) {
    return { ok: false, error: "Finish the setup steps first." };
  }

  if (!profile.onboarded_at) {
    const { error } = await supabase
      .from("profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) return { ok: false, error: "Couldn't finish setup." };
  }

  revalidatePath("/app");
  return { ok: true };
}
