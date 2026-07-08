"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import {
  setClientArchivedCore,
  setClientBlockedCore,
  updateClientCore,
} from "@/lib/admin-ops";

type Result = { ok: boolean; error?: string };

export async function updateClient(
  clientId: string,
  fullName: string,
  phone: string
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await updateClientCore(supabase, founder.id, clientId, fullName, phone);
  if (!result.ok) return result;
  revalidatePath("/admin/clients");
  return { ok: true };
}

export async function setClientBlocked(clientId: string, blocked: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setClientBlockedCore(supabase, founder.id, clientId, blocked);
  if (!result.ok) return result;
  revalidatePath("/admin/clients");
  return { ok: true };
}

export async function setClientArchived(clientId: string, archived: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setClientArchivedCore(supabase, founder.id, clientId, archived);
  if (!result.ok) return result;
  revalidatePath("/admin/clients");
  return { ok: true };
}
