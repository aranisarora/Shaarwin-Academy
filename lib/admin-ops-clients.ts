// Client lifecycle cores — edit, block (payment-dispute freeze), archive.
// Shared by the admin actions and the WhatsApp bot; RLS enforces.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/whatsapp/phone";
import type { OpResult } from "@/lib/admin-ops-types";

export async function updateClientCore(
  supabase: SupabaseClient,
  founderId: string,
  clientId: string,
  fullName: string,
  phone: string
): Promise<OpResult> {
  if (!fullName.trim()) return { ok: false, error: "Name can't be empty." };
  const normalized = phone.trim() ? normalizePhone(phone) : null;
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName.trim(), phone: normalized })
    .eq("id", clientId)
    .eq("role", "client");
  if (error) return { ok: false, error: "Couldn't save the details." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "client.update",
    entity: "profiles",
    entity_id: clientId,
  });
  return { ok: true };
}

/** Payment-dispute freeze: a blocked client can sign in but can't book. */
export async function setClientBlockedCore(
  supabase: SupabaseClient,
  founderId: string,
  clientId: string,
  blocked: boolean
): Promise<OpResult> {
  const { error } = await supabase
    .from("profiles")
    .update({ disputed: blocked })
    .eq("id", clientId)
    .eq("role", "client");
  if (error) return { ok: false, error: "Couldn't update the account." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: blocked ? "client.block" : "client.unblock",
    entity: "profiles",
    entity_id: clientId,
  });
  return { ok: true };
}

/** Archive hides the client from lists; nothing is lost and it's reversible. */
export async function setClientArchivedCore(
  supabase: SupabaseClient,
  founderId: string,
  clientId: string,
  archived: boolean
): Promise<OpResult> {
  const { error } = await supabase
    .from("profiles")
    .update({ deleted_at: archived ? new Date().toISOString() : null })
    .eq("id", clientId)
    .eq("role", "client");
  if (error) return { ok: false, error: "Couldn't update the account." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: archived ? "client.archive" : "client.restore",
    entity: "profiles",
    entity_id: clientId,
  });
  return { ok: true };
}
