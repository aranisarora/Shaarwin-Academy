import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The current auth user, or null. Wrapped in React `cache` so multiple callers
 * within the same request (e.g. a page body and the shell header) share a
 * single getUser round-trip instead of each hitting the auth server.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Display-only signed-in check for shell chrome (nav CTAs, footer links).
 * Reads the auth cookie locally instead of round-tripping to the Supabase
 * auth server, so marketing pages don't block their first byte on auth.
 * Never use this for authorization — the token is not verified here.
 */
export const hasAuthSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session !== null;
});

export type Profile = {
  id: string;
  role: "client" | "coach" | "founder";
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  default_address: string | null;
  stripe_customer_id: string | null;
  razorpay_customer_id: string | null;
  notification_prefs: Record<string, boolean>;
};

/**
 * Server-side auth guard. Redirects to /login when signed out.
 * Provisions the profile + player rows if the DB trigger hasn't (belt & braces).
 */
export async function requireUser(nextPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    const fullName =
      (user.user_metadata.full_name as string | undefined) ??
      user.email?.split("@")[0] ??
      "Player";
    await supabase.from("profiles").insert({
      id: user.id,
      role: "client",
      full_name: fullName,
      email: user.email ?? "",
    });
    await supabase.from("players").insert({
      client_id: user.id,
      full_name: fullName,
    });
    ({ data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle());
  }

  return { supabase, user, profile: profile as Profile };
}
