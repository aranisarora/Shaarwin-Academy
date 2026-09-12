"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { SCHOOL_PREVIEW_COOKIE } from "@/lib/school-preview";

/**
 * Founder-only. Set the preview cookie for the given school account. Navigation
 * to /school is handled client-side after this resolves — calling redirect()
 * here is unreliable when the action is invoked from a useTransition callback.
 * Returns true on success, false if the caller is not a founder or the target is
 * not a school account.
 *
 * The role check on the *target* is not ceremony. Everything downstream keys off
 * this cookie, and without it a founder could point the preview at any uuid and
 * land on a /school render scoped to an account that was never a school.
 */
export async function viewAsSchool(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "founder") return false;

  const { data: target } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (target?.role !== "school") return false;

  const store = await cookies();
  store.set(SCHOOL_PREVIEW_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4, // 4 hours — a testing session, not a standing grant
  });

  return true;
}

/** Clear the preview cookie. Navigation is handled client-side. */
export async function exitSchoolView(): Promise<void> {
  const store = await cookies();
  store.delete(SCHOOL_PREVIEW_COOKIE);
}
