"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";

type Result = { ok: boolean; error?: string };

export async function updateClient(
  clientId: string,
  fullName: string,
  phone: string
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  if (!fullName.trim()) return { ok: false, error: "Name can't be empty." };
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName.trim(), phone: phone.trim() || null })
    .eq("id", clientId)
    .eq("role", "client");
  if (error) return { ok: false, error: "Couldn't save the details." };
  await supabase.from("audit_log").insert({
    actor_id: founder.id,
    action: "client.update",
    entity: "profiles",
    entity_id: clientId,
  });
  revalidatePath("/admin/clients");
  return { ok: true };
}

/** Payment-dispute freeze: a blocked client can sign in but can't book. */
export async function setClientBlocked(clientId: string, blocked: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const { error } = await supabase
    .from("profiles")
    .update({ disputed: blocked })
    .eq("id", clientId)
    .eq("role", "client");
  if (error) return { ok: false, error: "Couldn't update the account." };
  await supabase.from("audit_log").insert({
    actor_id: founder.id,
    action: blocked ? "client.block" : "client.unblock",
    entity: "profiles",
    entity_id: clientId,
  });
  revalidatePath("/admin/clients");
  return { ok: true };
}

/** Archive hides the client from your lists; nothing is lost and it's reversible. */
export async function setClientArchived(clientId: string, archived: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const { error } = await supabase
    .from("profiles")
    .update({ deleted_at: archived ? new Date().toISOString() : null })
    .eq("id", clientId)
    .eq("role", "client");
  if (error) return { ok: false, error: "Couldn't update the account." };
  await supabase.from("audit_log").insert({
    actor_id: founder.id,
    action: archived ? "client.archive" : "client.restore",
    entity: "profiles",
    entity_id: clientId,
  });
  revalidatePath("/admin/clients");
  return { ok: true };
}
