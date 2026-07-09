"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import {
  deleteGroupClassCore,
  endGroupClassCore,
  topUpSessionsCore,
  updateGroupClassCore,
  type ClassUpdate,
} from "@/lib/admin-ops";

type Result = { ok: boolean; error?: string };

export async function updateGroupClass(input: ClassUpdate): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await updateGroupClassCore(supabase, founder.id, input);
  if (!result.ok) return result;
  revalidatePath("/admin/classes");
  revalidatePath("/admin/calendar");
  return { ok: true };
}

export async function endGroupClass(classId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await endGroupClassCore(supabase, founder.id, classId);
  if (!result.ok) return result;
  revalidatePath("/admin/classes");
  revalidatePath("/admin/calendar");
  return { ok: true };
}

export async function deleteGroupClass(classId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await deleteGroupClassCore(supabase, founder.id, classId);
  if (!result.ok) return result;
  revalidatePath("/admin/classes");
  revalidatePath("/admin/calendar");
  return { ok: true };
}

export async function topUpSessions(): Promise<Result & { created?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await topUpSessionsCore(supabase, founder.id);
  if (!result.ok) return result;
  revalidatePath("/admin/classes");
  revalidatePath("/admin/calendar");
  return { ok: true, created: result.created };
}
