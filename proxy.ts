import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { gateRedirect, roleHome, GATE_COLUMNS } from "@/lib/access-gates";
import { sessionClaims, AUTH_TIMEOUT_MS } from "@/lib/supabase/claims";

// "/school" (singular) is the school head's app. The public marketing page at
// "/schools" is a different route and stays public — the match below is exact
// or slash-prefixed, so "/schools" never matches "/school".
const PROTECTED_PREFIXES = ["/app", "/coach", "/admin", "/school"] as const;

// Founder preview cookies (see lib/coach-preview.ts and lib/school-preview.ts).
// While one is set, a founder is allowed into that app so the preview actually
// renders — both apps verify the cookie server-side, so this can't be used to
// escalate. Duplicated here rather than imported because the proxy runs on every
// request and must not pull the React/Supabase server modules those files bring.
const COACH_PREVIEW_COOKIE = "preview_coach_id";
const SCHOOL_PREVIEW_COOKIE = "preview_school_id";

// Which prefix each preview unlocks.
const PREVIEWS = [
  { cookie: COACH_PREVIEW_COOKIE, prefix: "/coach" },
  { cookie: SCHOOL_PREVIEW_COOKIE, prefix: "/school" },
] as const;

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

  const userId = (await sessionClaims(supabase.auth))?.sub ?? null;

  const { pathname, search } = request.nextUrl;
  const wanted = PROTECTED_PREFIXES.find(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!wanted) return response;

  const redirectTo = (path: string, query = "") => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = query;
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  // The query string is part of the destination, not decoration on it, so it
  // travels with the path. Every deep link we send out is read on a phone
  // that may not have a live session: the after-class WhatsApp points a coach
  // at /coach/players/<player>?session=<session>, and `session` is the whole
  // reason that link exists — it binds the assessment to the class just
  // taught. Sending only the pathname landed a signed-out coach on a bare
  // player page, where filing an assessment recorded an undated one and left
  // the session's entry in the backlog untouched, so the prompt went on
  // asking for work they had just done.
  const toLogin = () =>
    redirectTo("/login", `?next=${encodeURIComponent(`${pathname}${search}`)}`);

  if (!userId) return toLogin();

  // The app's role lives in `profiles`, not in the JWT — the `role` claim on a
  // Supabase token is the Postgres role ("authenticated"), which says nothing
  // about client/coach/founder. This select stays, and stays after the `wanted`
  // check so public routes never touch PostgREST. It also carries the two
  // membership-gate columns, so enforcing those gates here costs no extra round
  // trip (see lib/access-gates.ts for why they left `requireUser`).
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(GATE_COLUMNS)
    .eq("id", userId)
    .abortSignal(AbortSignal.timeout(AUTH_TIMEOUT_MS))
    .maybeSingle();

  if (error) {
    console.error("proxy: profiles gate read failed", error.message);
    return toLogin();
  }

  const role = profile?.role ?? "client";
  const home = roleHome(role);

  // A founder previewing a coach or a school is allowed into that app; without
  // this the wrong-role redirect below would bounce them straight back to /admin
  // and the preview would never render.
  const previewing =
    role === "founder" &&
    PREVIEWS.some(
      (p) =>
        !!request.cookies.get(p.cookie)?.value &&
        (pathname === p.prefix || pathname.startsWith(`${p.prefix}/`))
    );
  if (previewing) return response;

  if (!pathname.startsWith(home)) return redirectTo(home);

  // Membership gates: unapproved → /app/pending, un-onboarded → /app/onboarding.
  // Skipped when the row is missing, so that stays `requireUser`'s loud error
  // about the on_auth_user_created trigger rather than a silent bounce to the
  // pending screen.
  const gate = profile && gateRedirect(pathname, profile);
  if (gate) return redirectTo(gate);

  return response;
}

export const config = {
  // Run on every page so the Supabase session is refreshed and re-persisted
  // everywhere — including marketing pages like `/`. A Server Component can't
  // write refreshed cookies, so if the proxy skips a page, any token refresh
  // triggered during its render is lost and rotates the stored refresh token
  // into an invalid state → the visitor gets signed out. Static files, the
  // service worker, the manifest, robots, the sitemap and API routes render no
  // Server Component (route handlers write their own cookies), and router
  // prefetches of public pages render only layouts and loading skeletons, so
  // they skip it. Prefetches inside the apps still run it: the coach and school
  // layouts read the session for the founder preview banner.
  matcher: [
    "/(app|coach|admin|school)/:path*",
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
