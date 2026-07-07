"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

export async function saveProfile(input: {
  fullName: string;
  phone: string;
  defaultAddress: string;
  prefs: Record<string, boolean>;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!input.fullName.trim()) return { ok: false, error: "Name can't be empty." };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: input.fullName.trim(),
      phone: input.phone.trim() || null,
      default_address: input.defaultAddress.trim() || null,
      notification_prefs: input.prefs,
    })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save." };
  revalidatePath("/app/profile");
  return { ok: true };
}

export async function addPlayer(input: {
  fullName: string;
  dateOfBirth: string;
  skillLevel: string;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!input.fullName.trim()) return { ok: false, error: "Name can't be empty." };

  const { error } = await supabase.from("players").insert({
    client_id: user.id,
    full_name: input.fullName.trim(),
    date_of_birth: input.dateOfBirth || null,
    skill_level: input.skillLevel,
  });
  if (error) return { ok: false, error: "Couldn't add the player." };
  revalidatePath("/app/profile");
  return { ok: true };
}

export async function removePlayer(playerId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // Keep at least one player (the client themself) and block if live bookings exist.
  const { count: playerCount } = await supabase
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("client_id", user.id);
  if ((playerCount ?? 0) <= 1) {
    return { ok: false, error: "You need at least one player on the account." };
  }
  const { count: liveBookings } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("player_id", playerId)
    .in("status", ["confirmed", "waitlisted"]);
  if ((liveBookings ?? 0) > 0) {
    return { ok: false, error: "Cancel this player's bookings first." };
  }

  const { error } = await supabase
    .from("players")
    .delete()
    .eq("id", playerId)
    .eq("client_id", user.id);
  if (error) return { ok: false, error: "Couldn't remove the player." };
  revalidatePath("/app/profile");
  return { ok: true };
}
