import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
