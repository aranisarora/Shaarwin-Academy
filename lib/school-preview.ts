import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const SCHOOL_PREVIEW_COOKIE = "preview_school_id";

/**
 * Founder-only "view as school" preview, the twin of `lib/coach-preview.ts`.
 *
 * Its own cookie rather than a shared one with the coach preview: the two are
 * entered and left independently, and a single slot would mean opening a school
 * silently ended a coach preview the founder was midway through.
 *
 * Returns `{ userId }` — the school account being looked through — when an
 * active, authorised preview is in effect, else null. Verified server-side on
 * every call: a non-founder carrying the cookie gets null, so this cannot be
 * used to escalate. Wrapped in React `cache` so the layout banner and the page
 * body share one lookup per request.
 *
 * No name is returned, deliberately. The campus label the banner shows comes
 * from `getCampuses`, which every /school page already calls and which React
 * caches — so naming the school costs no query of its own.
 */
export const getSchoolPreview = cache(async () => {
  const store = await cookies();
  const userId = store.get(SCHOOL_PREVIEW_COOKIE)?.value;
  if (!userId) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "founder") return null;

  return { userId };
});
