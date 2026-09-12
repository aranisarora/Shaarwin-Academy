"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import {
  openSchoolLoginCore,
  resetSchoolPasswordCore,
  type SchoolLogin,
} from "@/lib/admin-ops-schools";

type Result = { ok: boolean; error?: string; login?: SchoolLogin };

/**
 * What tapping a school does: hand back its credentials, minting the account
 * first if this campus has never had one. The founder never asks for a login to
 * be created — he asks to see it, and it exists by the time he is looking.
 *
 * Only the first open of a campus writes anything, so only that one revalidates.
 * Re-reading an existing login changes nothing, and the founder is standing in
 * front of an open sheet — a refetch there is a flicker with no news in it.
 */
export async function openSchoolLogin(venueId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await openSchoolLoginCore(supabase, founder.id, venueId);
  if (result.created) revalidatePath("/admin/schools");
  return result;
}

/**
 * The one way to take a school's access away, and now the only destructive
 * control on the screen: "Remove the login" sat next to this doing a rounder
 * version of the same job, and undoing itself, since the next tap on the row
 * mints the campus a fresh login anyway. `removeSchoolAccountCore` survives in
 * `lib/admin-ops-schools` — it is still what an account deletion runs through —
 * but nothing in the founder's app reaches for it any more.
 */
export async function resetSchoolPassword(userId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  return resetSchoolPasswordCore(supabase, founder.id, userId);
}
