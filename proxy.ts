import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { gateRedirect, GATE_COLUMNS } from "@/lib/access-gates";

const PROTECTED_PREFIXES = ["/app", "/coach", "/admin"] as const;

const roleHome: Record<string, string> = {
  client: "/app",
  coach: "/coach",
  founder: "/admin",
};

// Founder "view as coach" preview cookie (see lib/coach-preview.ts). While it is
// set, a founder is allowed into /coach so the preview actually renders — the
// coach pages verify the cookie server-side, so this can't be used to escalate.
const PREVIEW_COOKIE = "preview_coach_id";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Verify the session — and refresh it, which is required for SSR auth to stay
  // alive. `getClaims()` with no argument calls `getSession()` internally, so an
  // expiring token is still refreshed and the `setAll` writer above still
  // persists the rotated cookies. Unlike `getUser()` it then verifies the token
  // locally against the public JWKS (the project signs with asymmetric ES256)
  // instead of asking the auth server — turning a ~150ms Tokyo round trip on
  // *every* request, including public marketing pages, into local crypto.
  //
  // Note it falls back to a full `getUser()` call, silently, if the token's alg
  // is HS*, it carries no `kid`, or WebCrypto is missing. None apply here, but
  // the symptom of a regression would be lost speed rather than an error.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;

  const { pathname } = request.nextUrl;
  const wanted = PROTECTED_PREFIXES.find(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!wanted) return response;

  if (!userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // The app's role lives in `profiles`, not in the JWT — the `role` claim on a
  // Supabase token is the Postgres role ("authenticated"), which says nothing
  // about client/coach/founder. This select stays, and stays after the `wanted`
  // check so public routes never touch PostgREST. It also carries the two
  // membership-gate columns, so enforcing those gates here costs no extra round
  // trip (see lib/access-gates.ts for why they left `requireUser`).
  const { data: profile } = await supabase
    .from("profiles")
    .select(GATE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  const role = profile?.role ?? "client";
  const home = roleHome[role] ?? "/app";

  // A founder previewing a coach is allowed into /coach; without this the
  // wrong-role redirect below would bounce them straight back to /admin and the
  // preview would never render.
  const previewingCoach =
    role === "founder" &&
    !!request.cookies.get(PREVIEW_COOKIE)?.value &&
    (pathname === "/coach" || pathname.startsWith("/coach/"));
  if (previewingCoach) return response;

  // Wrong-role access → redirect to own home.
  if (!pathname.startsWith(home)) {
    const url = request.nextUrl.clone();
    url.pathname = home;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Membership gates: unapproved → /app/pending, un-onboarded → /app/onboarding.
  // Skipped when the row is missing, so that stays `requireUser`'s loud error
  // about the on_auth_user_created trigger rather than a silent bounce to the
  // pending screen.
  if (profile) {
    const gate = gateRedirect(pathname, profile);
    if (gate) {
      const url = request.nextUrl.clone();
      url.pathname = gate;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // Run on every route except static assets so the Supabase session is
  // refreshed and re-persisted everywhere — including marketing pages like `/`.
  // A Server Component can't write refreshed cookies, so if the proxy skips a
  // route, any token refresh triggered during render is lost and rotates the
  // stored refresh token into an invalid state → the visitor gets signed out.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4)$).*)",
  ],
};
