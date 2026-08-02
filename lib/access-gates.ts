/**
 * The two membership gates that hold a client short of the rest of `/app`:
 * approval, then household onboarding.
 *
 * These used to live in `requireUser` (lib/auth.ts), which every protected page
 * awaited *before* returning any JSX. That made the gates correct but made the
 * shell wait a Supabase round trip. They run in the proxy instead (proxy.ts),
 * which already reads the `profiles` row for its role check — so enforcing them
 * costs zero extra round trips and, critically, redirects *before* a single byte
 * of HTML is streamed. Once streaming has begun neither the response status nor
 * the destination can change, so a gate behind a `<Suspense>` boundary would
 * flash the destination chrome at a user who is about to be bounced.
 *
 * Kept as a pure function so it can be unit-tested without a request, a DB or a
 * running Next server (lib/access-gates.test.ts).
 */

/** The subset of `profiles` the gates read. */
export type GateProfile = {
  role: string | null;
  approval_status: string | null;
  onboarded_at: string | null;
};

/** The `profiles` columns `gateRedirect` needs — the proxy's select must cover these. */
export const GATE_COLUMNS = "role,approval_status,onboarded_at";

/**
 * Where each role's app lives. Shared by the proxy (which bounces wrong-role
 * requests here) and `/login` (which sends an already-signed-in visitor here),
 * so the two can't disagree about where a role belongs.
 *
 * "/school" is the school head's app. The public marketing page at "/schools"
 * is a different route: the proxy matches prefixes exactly or slash-prefixed,
 * so the plural never collides with the singular.
 */
export const ROLE_HOME: Record<string, string> = {
  client: "/app",
  coach: "/coach",
  founder: "/admin",
  school: "/school",
};

/** A role's home, defaulting to the client app for an unknown or missing role. */
export function roleHome(role: string | null | undefined): string {
  return (role && ROLE_HOME[role]) || "/app";
}

/**
 * Where this request must be redirected before rendering, or `null` to let it
 * through.
 *
 * `pathname` is the real request path. Only `/app` is gated: coaches and
 * founders are exempt from both gates, and their apps live under `/coach` and
 * `/admin`, so callers pass paths outside `/app` through untouched.
 */
export function gateRedirect(
  pathname: string,
  profile: GateProfile
): string | null {
  const underApp = pathname === "/app" || pathname.startsWith("/app/");
  if (!underApp) return null;

  // Coaches and founders are exempt from every branch below.
  if (profile.role !== "client") return null;

  // Closed membership: a self-signup client who isn't approved yet is held at
  // the pending screen (request form → waiting → approved) before any other
  // /app page. Existing clients and founder-invited clients are 'approved', so
  // they never see it.
  if (profile.approval_status !== "approved") {
    return pathname === "/app/pending" ? null : "/app/pending";
  }

  // Clients who haven't completed household onboarding (including accounts
  // created before the flow existed) are routed there before any /app page.
  // /app/onboarding/done sits deliberately outside this gate — booking already
  // stamped onboarded_at by the time it renders (app/app/onboarding/actions.ts).
  if (!profile.onboarded_at) {
    return pathname === "/app/onboarding" ? null : "/app/onboarding";
  }

  return null;
}
