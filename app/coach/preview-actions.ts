"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_COOKIE } from "@/lib/coach-preview";

/**
 * Founder-only. Start previewing a coach's app: set the preview cookie and land
 * on the coach schedule. Role is re-checked here so the cookie can only be set
 * by a founder, regardless of where the button was rendered.
 */
export async function viewAsCoach(coachId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "founder") return;

  const store = await cookies();
  store.set(PREVIEW_COOKIE, coachId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4, // 4 hours — a testing session, not a standing grant
  });

  redirect("/coach");
}

/** Clear the preview and return to the admin coaches list. */
export async function exitCoachView() {
  const store = await cookies();
  store.delete(PREVIEW_COOKIE);
  redirect("/admin/coaches");
}
