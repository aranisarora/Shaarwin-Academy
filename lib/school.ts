import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getMasteryMap } from "@/lib/mastery";
import { getSchoolPreview } from "@/lib/school-preview";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Campus = { venueId: string; name: string; unit: string | null };

type Pupil = {
  id: string;
  name: string;
  grade: number | null;
  sessions: number;
  attended: number;
  noShows: number;
  mastery: number;
};

/**
 * The campuses this school account may see.
 *
 * No `.eq("user_id", …)` filter for a real school: the "school reads own link"
 * policy already scopes `school_admins` to the caller's own rows, and a
 * redundant filter here would quietly become the real guard if that policy were
 * ever relaxed. Read as written, this returns nothing at all for a non-school
 * role.
 *
 * The one exception is a founder previewing a school, and it is exactly why the
 * filter has to exist at all in that branch: "founder all school admins" lets
 * him read *every* row, so without narrowing to the previewed account he would
 * see every campus in the academy stitched into one roster — the opposite of
 * what "view as school" is for.
 *
 * Wrapped in React `cache` so the roster, the page title, the preview banner and
 * the More screen share one round trip within a request. It takes no arguments
 * and builds its own client because `cache` keys on argument identity, and every
 * caller holds a different client.
 */
export const getCampuses = cache(async (): Promise<Campus[]> => {
  const [preview, supabase] = await Promise.all([getSchoolPreview(), createClient()]);

  const query = supabase.from("school_admins").select("venue_id,venues(name,unit)");
  const { data } = preview ? await query.eq("user_id", preview.userId) : await query;

  return (data ?? [])
    .map((row) => ({
      venueId: row.venue_id,
      name: row.venues?.name ?? "School",
      unit: row.venues?.unit ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

/** "TISB" or "TISB · Sports Block" — what the shell puts in the title bar. */
export function campusLabel(campuses: Campus[]): string {
  if (campuses.length === 0) return "School";
  if (campuses.length > 1) return `${campuses.length} campuses`;
  const [only] = campuses;
  return only.unit ? `${only.name} · ${only.unit}` : only.name;
}

/**
 * Every pupil on the school's campuses, with their attendance roll-up.
 *
 * Both halves are RLS-scoped in their own right — `school reads own pupils`
 * and `school reads pupil bookings` — so the `.in()` on venue ids is a
 * narrowing convenience, not the security boundary. A school pupil carries
 * `client_id = null`, which is why the bookings read needs its own policy at
 * all: the client-owns-booking policy matches none of these rows.
 *
 * The bookings ride embedded under each pupil. max_rows caps only the top
 * level, so a busy school's history can no longer be cut off at 1000 rows, and
 * no pupil id list has to travel in a URL. Cancellations are filtered out in
 * the embed: they aren't attendance, and would inflate every pupil's count with
 * classes they were pulled out of.
 */
export async function getRoster(supabase: Supabase, venueIds: string[]): Promise<Pupil[]> {
  if (venueIds.length === 0) return [];

  const { data: players } = await supabase
    .from("players")
    .select("id,full_name,grade,bookings(status)")
    .in("school_venue_id", venueIds)
    .in("bookings.status", ["confirmed", "attended", "no_show"])
    .order("full_name");

  const pupils = players ?? [];
  if (pupils.length === 0) return [];

  const masteryMap = await getMasteryMap(
    supabase,
    pupils.map((p) => p.id)
  );

  return pupils.map((p) => ({
    id: p.id,
    name: p.full_name,
    grade: p.grade,
    sessions: p.bookings.length,
    attended: p.bookings.filter((b) => b.status === "attended").length,
    noShows: p.bookings.filter((b) => b.status === "no_show").length,
    mastery: masteryMap.get(p.id) ?? 0,
  }));
}

/**
 * The roster line under a pupil's name. Grade is omitted rather than shown as
 * "Grade 0" — university pupils have none (see the grade→age note on
 * `add_school_player`).
 */
export function pupilMeta(p: Pupil): string {
  const parts: string[] = [];
  if (p.grade != null) parts.push(`Grade ${p.grade}`);
  parts.push(`${p.sessions} session${p.sessions === 1 ? "" : "s"}`);
  if (p.attended > 0) parts.push(`${p.attended} attended`);
  if (p.noShows > 0) parts.push(`${p.noShows} no-shows`);
  return parts.join(" · ");
}
