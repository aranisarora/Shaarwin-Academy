import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { StructuredAddress } from "@/lib/address";

/**
 * The current auth user, or null. Wrapped in React `cache` so multiple callers
 * within the same request (e.g. a page body and the shell header) share one
 * lookup instead of each re-verifying the token.
 *
 * Uses `getClaims()`, not `getUser()`. The project signs tokens with asymmetric
 * ES256, so the access token can be verified locally against the public JWKS —
 * no call to the auth server. `getUser()` is a network round trip to Tokyo on
 * every render, and users are in India, so that was ~150ms before any page
 * query could start.
 *
 * Only `id` and `email` are returned because they are all any caller reads;
 * widening this back to the full `User` would mean going back to the network.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
});

/**
 * Keep in step with `Profile` below — this is the shape the select produces.
 * One literal rather than a concatenation, so the generated Supabase types can
 * still infer the row shape from it.
 */
const PROFILE_COLUMNS =
  "id,role,full_name,email,phone,avatar_url,default_address,default_lat,default_lng,address_details,razorpay_customer_id,notification_prefs,onboarded_at,approval_status";

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

  // Exactly the columns `Profile` declares, not select("*"): this runs on every
  // protected navigation, and the table also carries stripe_customer_id,
  // disputed, deleted_at, created_at and onboarding_step, which nothing here
  // reads. The screens that do need those fetch them in their own selects.
  const { data: profile } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
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
