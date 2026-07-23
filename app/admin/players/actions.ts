"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import {
  addClientInviteCore,
  deletePendingClientCore,
  savePendingClientCore,
  setClientArchivedCore,
  setClientBlockedCore,
  updateClientCore,
  type ClientInviteDetails,
} from "@/lib/admin-ops";

type Result = { ok: boolean; error?: string };

export async function addClientInvite(details: ClientInviteDetails): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await addClientInviteCore(supabase, founder.id, details);
  if (!result.ok) return result;
  revalidatePath("/admin/players");
  return { ok: true };
}

export async function savePendingClient(
  id: string,
  details: ClientInviteDetails
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await savePendingClientCore(supabase, founder.id, id, details);
  if (!result.ok) return result;
  revalidatePath("/admin/players");
  return { ok: true };
}

export async function deletePendingClient(id: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await deletePendingClientCore(supabase, founder.id, id);
  if (!result.ok) return result;
  revalidatePath("/admin/players");
  return { ok: true };
}

export async function updateClient(
  clientId: string,
  fullName: string,
  phone: string
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await updateClientCore(supabase, founder.id, clientId, fullName, phone);
  if (!result.ok) return result;
  revalidatePath("/admin/players");
  return { ok: true };
}

export async function setClientBlocked(clientId: string, blocked: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setClientBlockedCore(supabase, founder.id, clientId, blocked);
  if (!result.ok) return result;
  revalidatePath("/admin/players");
  return { ok: true };
}

export async function setClientArchived(clientId: string, archived: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setClientArchivedCore(supabase, founder.id, clientId, archived);
  if (!result.ok) return result;
  revalidatePath("/admin/players");
  return { ok: true };
}

/**
 * Approve or deny a closed-membership signup request. The single approve/deny
 * implementation lives in the review_signup_request RPC — the WhatsApp founder
 * buttons call the same one. Deny is reversible (call again with approve=true).
 */
export async function reviewSignupRequest(
  clientId: string,
  approve: boolean
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const { data, error } = await supabase.rpc("review_signup_request", {
    p_client: clientId,
    p_approve: approve,
  });
  if (error) return { ok: false, error: "Couldn't update that request." };
  const result = (data ?? {}) as { ok?: boolean; error?: string };
  if (!result.ok && result.error === "already_reviewed") {
    revalidatePath("/admin/players");
    return { ok: false, error: "Already handled." };
  }
  if (!result.ok) return { ok: false, error: "Couldn't update that request." };
  revalidatePath("/admin/players");
  return { ok: true };
}
