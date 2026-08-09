"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveCoachProfile(input: {
  bio: string;
  baseLat: number;
  baseLng: number;
  baseAddress?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase
    .from("coaches")
    .update({
      bio: input.bio.trim() || null,
      base_lat: input.baseLat,
      base_lng: input.baseLng,
      // Only overwrite the label when the coach picked a fresh address.
      ...(input.baseAddress !== undefined
        ? { base_address: input.baseAddress?.trim() || null }
        : {}),
    })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save." };
  revalidatePath("/coach/more");
  return { ok: true };
}
