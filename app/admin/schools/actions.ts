"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import {
  createSchoolAccountCore,
  removeSchoolAccountCore,
  resetSchoolPasswordCore,
  type Credentials,
} from "@/lib/admin-ops-schools";

type Result = { ok: boolean; error?: string; credentials?: Credentials };

export async function createSchoolAccount(input: {
  venueId: string;
  /** Optional real address; left out, the core mints one from the venue. */
  email?: string;
}): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await createSchoolAccountCore(supabase, founder.id, input);
  if (result.ok) revalidatePath("/admin/schools");
  return result;
}

export async function resetSchoolPassword(userId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  return resetSchoolPasswordCore(supabase, founder.id, userId);
}

export async function removeSchoolAccount(userId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await removeSchoolAccountCore(supabase, founder.id, userId);
  if (result.ok) revalidatePath("/admin/schools");
  return result;
}
