// Academy settings cores — read and update the numeric settings table
// (cancellation window, booking cutoff, travel buffer, waitlist claim minutes,
// etc.). Shared by the admin actions and the WhatsApp bot.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpResult } from "@/lib/admin-ops-types";

export async function getSettingsCore(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const { data } = await supabase.from("settings").select("key,value");
  const out: Record<string, number> = {};
  for (const row of data ?? []) out[row.key] = Number(row.value);
  return out;
}

export async function saveSettingsCore(
  supabase: SupabaseClient,
  founderId: string,
  values: Record<string, number>
): Promise<OpResult> {
  const applied: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0) continue;
    await supabase
      .from("settings")
      .upsert({ key, value, updated_by: founderId }, { onConflict: "key" });
    applied[key] = value;
  }
  if (Object.keys(applied).length === 0) {
    return { ok: false, error: "Nothing valid to update." };
  }
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "settings.update",
    entity: "settings",
    meta: applied,
  });
  return { ok: true };
}
