"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_COOKIE } from "@/lib/coach-preview";

/**
 * Founder-only. Set the preview cookie for the given coach. Navigation to
 * /coach is handled client-side after this resolves — calling redirect() here
 * is unreliable when the action is invoked from a useTransition callback.
 * Returns true on success, false if the caller is not a founder.
 */
export async function viewAsCoach(coachId: string): Promise<boolean> {
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

  const store = await cookies();
  store.set(PREVIEW_COOKIE, coachId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4, // 4 hours — a testing session, not a standing grant
  });

  return true;
}

/** Clear the preview cookie. Navigation is handled client-side. */
export async function exitCoachView(): Promise<void> {
  const store = await cookies();
  store.delete(PREVIEW_COOKIE);
}
