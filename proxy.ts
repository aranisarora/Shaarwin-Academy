import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  // Refresh the session — required for SSR auth to stay alive.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const wanted = PROTECTED_PREFIXES.find(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!wanted) return response;

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
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
