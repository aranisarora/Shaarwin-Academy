"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveCoachProfile(input: {
  bio: string;
  baseLat: number;
  baseLng: number;
  radiusKm: number;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!Number.isFinite(input.radiusKm) || input.radiusKm < 1 || input.radiusKm > 50) {
    return { ok: false, error: "Radius must be between 1 and 50 km." };
  }

  const { error } = await supabase
    .from("coaches")
    .update({
      bio: input.bio.trim() || null,
      base_lat: input.baseLat,
      base_lng: input.baseLng,
      travel_radius_km: input.radiusKm,
    })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save." };
  revalidatePath("/coach/profile");
  return { ok: true };
}
