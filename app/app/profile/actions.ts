"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizePhoneInput } from "@/lib/whatsapp/phone";
import { adminClient } from "@/lib/whatsapp/identity";
import type { StructuredAddress } from "@/lib/address";

type Result = { ok: boolean; error?: string };

export async function saveProfile(input: {
  fullName: string;
  phone: string;
  defaultAddress: string;
  prefs: Record<string, boolean>;
  addressDetails?: StructuredAddress | null;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!input.fullName.trim()) return { ok: false, error: "Name can't be empty." };

  // profiles.phone is how the WhatsApp bot identifies an account, and it
  // compares against the normalized inbound number. Storing what was typed
  // ("98123 45678") would never match "+919812345678" and would silently drop
  // a working account into guest mode, so normalize on the way in.
  const phone = input.phone.trim() ? normalizePhoneInput(input.phone) : null;
  if (input.phone.trim() && !phone) {
    return {
      ok: false,
      error: "That doesn't look like a phone number — include the country code, e.g. +91.",
    };
  }

  // The column is unique; pre-check for a friendly message, not a constraint error.
  if (phone) {
    const { data: taken } = await adminClient()
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .neq("id", user.id)
      .maybeSingle();
    if (taken) {
      return { ok: false, error: "That number is already on another account." };
    }
  }

  const d = input.addressDetails;
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: input.fullName.trim(),
      phone,
      // The formatted line stays the canonical flat value; the structured form
      // (when present) also finally populates the long-unused lat/lng columns.
      default_address: (d?.formatted || input.defaultAddress).trim() || null,
      notification_prefs: input.prefs,
      ...(d !== undefined
        ? { address_details: d, default_lat: d?.lat ?? null, default_lng: d?.lng ?? null }
        : {}),
    })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save." };
  revalidatePath("/app/profile");
  return { ok: true };
}

export async function addPlayer(input: {
  fullName: string;
  dateOfBirth: string;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!input.fullName.trim()) return { ok: false, error: "Name can't be empty." };

  // skill_level takes the DB default ('beginner') — mastery supersedes it on
  // every client surface now.
  const { error } = await supabase.from("players").insert({
    client_id: user.id,
    full_name: input.fullName.trim(),
    date_of_birth: input.dateOfBirth || null,
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
