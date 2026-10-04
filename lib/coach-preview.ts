import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

export const PREVIEW_COOKIE = "preview_coach_id";

/**
 * Founder-only "view as coach" preview. When a founder sets the preview cookie
 * (from the admin coaches list or a calendar session), coach pages render that
 * coach's view instead of the founder's own (empty) one.
 *
 * Returns `{ coachId, coachName }` when an active, authorised preview is in
 * effect, else null. Verified server-side every call: a non-founder carrying
 * the cookie gets null, so this can't be used to escalate. Wrapped in React
 * `cache` so the layout banner and the page body share one lookup per request.
 */
export const getCoachPreview = cache(async () => {
  const store = await cookies();
  const coachId = store.get(PREVIEW_COOKIE)?.value;
  if (!coachId) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("profiles")
    .select("id,role,full_name")
    .in("id", [user.id, coachId]);
  if (rows?.find((row) => row.id === user.id)?.role !== "founder") return null;

  const coach = rows.find((row) => row.id === coachId);
  return { coachId, coachName: coach?.full_name ?? "Coach" };
});

/**
 * The coach id whose view should render: the previewed coach for an authorised
 * founder preview, otherwise the signed-in user's own id. Coach pages call this
 * in place of `user.id` so a founder preview and a real coach share one path.
 */
export async function effectiveCoachId(userId: string) {
  const preview = await getCoachPreview();
  return preview?.coachId ?? userId;
}
