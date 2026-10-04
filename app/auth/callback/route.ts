import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { roleHome } from "@/lib/access-gates";

/** OAuth (Google) code exchange. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (next?.startsWith("/") && next !== "/app") {
        return NextResponse.redirect(`${origin}${next}`);
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();
      return NextResponse.redirect(`${origin}${roleHome(profile?.role)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
