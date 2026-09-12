import { NextResponse, type NextRequest } from "next/server";
import {
  GATE_COOKIE,
  GATE_COOKIE_MAX_AGE,
  gateCookieValue,
  keyOpens,
} from "@/lib/schedule-gate";

// The only thing this does: turn `?key=…` on /schedule into a cookie.
//
// A link with the key in it is what the assistant sends the owner. A page
// cannot set a cookie, so the exchange happens here — and the key comes off
// the URL whether it was right or not, so it is never left sitting in an
// address bar, a share sheet or a browser history for longer than one
// redirect. What the cookie is then worth is the page's decision
// (lib/schedule-gate.ts); nothing here lets a request through on its own.

export async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const offered = url.searchParams.get("key");
  if (offered === null) return NextResponse.next();

  const clean = url.clone();
  clean.searchParams.delete("key");
  const response = NextResponse.redirect(clean);

  if (await keyOpens(offered)) {
    response.cookies.set({
      name: GATE_COOKIE,
      value: await gateCookieValue(offered),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/schedule",
      maxAge: GATE_COOKIE_MAX_AGE,
    });
  }
  return response;
}

export const config = { matcher: "/schedule" };
