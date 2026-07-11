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

/** What an admin enters when pre-registering an offline client by phone. */
export type ClientInviteDetails = {
  phone: string;
  fullName: string;
  notes: string;
};

/**
 * Pre-register a client by phone number. When any account ends up with this
 * phone (web signup + WhatsApp link, or messaging the bot cold), the
 * profiles-phone trigger claims the invite and applies the name/notes.
 */
export async function addClientInviteCore(
  supabase: SupabaseClient,
  founderId: string,
  d: ClientInviteDetails
): Promise<OpResult> {
  const phone = normalizePhone(d.phone);
  if (!phone) return { ok: false, error: "That phone number doesn't look valid." };

  // Already an account with this number? Nothing to pre-register.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id,full_name")
    .eq("phone", phone)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: `${existing.full_name || "Someone"} already has an account with that number.`,
    };
  }

  const { error } = await supabase.from("client_invites").upsert(
    {
      phone,
      full_name: d.fullName.trim() || null,
      notes: d.notes.trim() || null,
      created_by: founderId,
      claimed_at: null,
      claimed_by: null,
    },
    { onConflict: "phone" }
  );
  if (error) return { ok: false, error: "Couldn't save the client." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "client.invite",
    entity: "client_invites",
    meta: { phone, name: d.fullName.trim() },
  });
  return { ok: true };
}

/** Edit a not-yet-claimed client invite. */
export async function savePendingClientCore(
  supabase: SupabaseClient,
  founderId: string,
  id: string,
  d: ClientInviteDetails
): Promise<OpResult> {
  const phone = normalizePhone(d.phone);
  if (!phone) return { ok: false, error: "That phone number doesn't look valid." };
  const { error } = await supabase
    .from("client_invites")
    .update({
      phone,
      full_name: d.fullName.trim() || null,
      notes: d.notes.trim() || null,
    })
    .eq("id", id)
    .is("claimed_at", null);
  if (error) return { ok: false, error: "Couldn't save the client." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "client.invite_update",
    entity: "client_invites",
    entity_id: id,
  });
  return { ok: true };
}

/** Remove a not-yet-claimed client invite. */
export async function deletePendingClientCore(
  supabase: SupabaseClient,
  founderId: string,
  id: string
): Promise<OpResult> {
  const { error } = await supabase
    .from("client_invites")
    .delete()
    .eq("id", id)
    .is("claimed_at", null);
  if (error) return { ok: false, error: "Couldn't remove the client." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "client.invite_revoke",
    entity: "client_invites",
    entity_id: id,
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
