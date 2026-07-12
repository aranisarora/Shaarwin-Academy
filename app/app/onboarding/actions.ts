"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

type PlayerInput = {
  /** Existing players row to update; omitted for new players. */
  id?: string;
  fullName: string;
  dateOfBirth: string;
  skillLevel: string;
};

const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "elite"];

/**
 * Finish household onboarding: upsert the roster, drop the auto-created
 * self-player when the account holder isn't playing, stamp onboarded_at.
 * RLS ("own household" / "own profile") scopes every write to the caller.
 */
export async function submitPlayersStep(input: {
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
    const row = {
      full_name: p.fullName,
      date_of_birth: p.dateOfBirth || null,
      skill_level: SKILL_LEVELS.includes(p.skillLevel) ? p.skillLevel : "beginner",
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

  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_step: 2 })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't advance setup." };

  revalidatePath("/app");
  revalidatePath("/app/profile");
  return { ok: true };
}

export async function advanceOnboardingStep(step: number): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_step: step })
    .eq("id", user.id);
  
  if (error) return { ok: false, error: "Couldn't advance setup." };
  
  revalidatePath("/app/onboarding");
  return { ok: true };
}

export async function submitPhoneFallback(phone: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase
    .from("profiles")
    .update({ phone })
    .eq("id", user.id);
  
  if (error) return { ok: false, error: "Couldn't save phone number." };
  
  return advanceOnboardingStep(3);
}

export async function finishOnboarding(): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't finish setup." };

  revalidatePath("/app");
  revalidatePath("/app/profile");
  return { ok: true };
}
