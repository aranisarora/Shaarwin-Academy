import { cache } from "react";
import type { createClient } from "@/lib/supabase/server";
import { getMasteryMap } from "@/lib/mastery";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type Campus = { venueId: string; name: string; unit: string | null };

export type Pupil = {
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
 * No `.eq("user_id", …)` filter: the "school reads own link" policy already
 * scopes `school_admins` to the caller's own rows, and a redundant filter here
 * would quietly become the real guard if that policy were ever relaxed. Read as
 * written, this returns nothing at all for a non-school role.
 *
 * Wrapped in React `cache` so the roster, the page title and the More screen
 * share one round trip within a request.
 */
export const getCampuses = cache(async (supabase: Supabase): Promise<Campus[]> => {
  const { data } = await supabase
    .from("school_admins")
    .select("venue_id,venues(name,unit)");

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
 * Both queries are RLS-scoped in their own right — `school reads own pupils`
 * and `school reads pupil bookings` — so the `.in()` on venue ids is a
 * narrowing convenience, not the security boundary. A school pupil carries
 * `client_id = null`, which is why the bookings read needs its own policy at
 * all: the client-owns-booking policy matches none of these rows.
 */
export async function getRoster(supabase: Supabase, venueIds: string[]): Promise<Pupil[]> {
  if (venueIds.length === 0) return [];

  const { data: players } = await supabase
    .from("players")
    .select("id,full_name,grade")
    .in("school_venue_id", venueIds)
    .order("full_name");

  const pupils = players ?? [];
  if (pupils.length === 0) return [];

  const ids = pupils.map((p) => p.id);

  // The mastery RPC and the bookings roll-up are independent — both key off
  // `ids`, which is already in hand.
  const [{ data: bookings }, masteryMap] = await Promise.all([
    supabase.from("bookings").select("player_id,status").in("player_id", ids),
    getMasteryMap(supabase, ids),
  ]);

  const tally = new Map<string, { sessions: number; attended: number; noShows: number }>();
  for (const b of bookings ?? []) {
    // Cancellations aren't attendance — they'd otherwise inflate every pupil's
    // session count with classes they were pulled out of.
    if (!["confirmed", "attended", "no_show"].includes(b.status)) continue;
    const entry = tally.get(b.player_id) ?? { sessions: 0, attended: 0, noShows: 0 };
    entry.sessions += 1;
    if (b.status === "attended") entry.attended += 1;
    if (b.status === "no_show") entry.noShows += 1;
    tally.set(b.player_id, entry);
  }

  return pupils.map((p) => {
    const t = tally.get(p.id) ?? { sessions: 0, attended: 0, noShows: 0 };
    return {
      id: p.id,
      name: p.full_name,
      grade: p.grade,
      ...t,
      mastery: masteryMap.get(p.id) ?? 0,
    };
  });
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
