import { createClient } from "@/lib/supabase/server";

/** Server-action guard: returns the signed-in founder, or null for anyone else. */
export async function requireFounder() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, founder: null };
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return { supabase, founder: me?.role === "founder" ? user : null };
}
