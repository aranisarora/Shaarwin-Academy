import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { StructuredAddress } from "@/lib/address";

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

export type Profile = {
  id: string;
  role: "client" | "coach" | "founder";
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  default_address: string | null;
  default_lat: number | null;
  default_lng: number | null;
  address_details: Partial<StructuredAddress> | null;
  razorpay_customer_id: string | null;
  notification_prefs: Record<string, boolean>;
  onboarded_at: string | null;
  approval_status: "pending" | "approved" | "denied";
};

/**
 * Server-side auth guard. Redirects to /login when signed out.
 *
 * The profile row is provisioned by the `on_auth_user_created` trigger on
 * auth.users (public.handle_new_user), which inserts the profile and the
 * client's first player row inside the signup transaction. This function
 * therefore reads that row and never creates it: a signed-in user without one
 * means the trigger is missing or failed, which is a bug to surface, not to
 * paper over with a second provisioning path that can drift from the first.
 *
 * Uses the request-cached `getCurrentUser` so the auth-server round-trip is
 * shared with any other caller in the same render (e.g. shell chrome like
 * PlayerRailLinks) instead of each one re-verifying the token independently.
 */
export async function requireUser(nextPath: string) {
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    throw new Error(
      `No profiles row for signed-in user ${user.id} — check the ` +
        `on_auth_user_created trigger on auth.users.`
    );
  }

  // Closed membership: a self-signup client who isn't approved yet is held at
  // the pending screen (request form → waiting → approved) before any other
  // /app page. Existing clients and founder-invited clients are 'approved', so
  // they never see it. Coaches and founders are exempt from every branch below.
  const p = profile as Profile;
  if (
    p.role === "client" &&
    p.approval_status !== "approved" &&
    nextPath.startsWith("/app") &&
    nextPath !== "/app/pending"
  ) {
    redirect("/app/pending");
  }

  // Clients who haven't completed household onboarding (including accounts
  // created before the flow existed) are routed there before any /app page.
  if (
    p.role === "client" &&
    p.approval_status === "approved" &&
    !p.onboarded_at &&
    nextPath.startsWith("/app") &&
    nextPath !== "/app/onboarding"
  ) {
    redirect("/app/onboarding");
  }

  return { supabase, user, profile: p };
}
