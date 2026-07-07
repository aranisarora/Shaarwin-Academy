"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveSettings(
  values: Record<string, number>
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

  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0) continue;
    await supabase
      .from("settings")
      .upsert({ key, value, updated_by: user.id }, { onConflict: "key" });
  }

  await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "settings.update",
    entity: "settings",
    meta: values,
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}
