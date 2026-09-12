"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import { saveSettingsCore } from "@/lib/admin-ops";

export async function saveSettings(
  values: Record<string, number>
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };

  const result = await saveSettingsCore(supabase, founder.id, values);
  if (!result.ok) return result;

  revalidatePath("/admin/settings");
  return { ok: true };
}
