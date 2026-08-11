// What a class that has already run is still waiting on.
//
// Three things happen after the whistle, and each is a promise to somebody
// outside the building: the coach marks that they arrived, marks who turned up,
// and rates the players who did. A session missing any of them is not finished,
// however long ago it ended — and until now the founder's schedule had no way
// to say so. It showed the register nowhere, assessments nowhere, and a missing
// arrival as a grey "Not marked" that read like a footnote.
//
// THE DEFINITIONS ARE NOT INVENTED HERE. They are the ones
// `get_coach_wrapup_queue` already chases coaches with (schema.sql, migration
// 0077), restated in TypeScript so the founder's screen and the coach's prompt
// cannot drift into disagreeing about who owes what:
//
//   attendance owed — a booking still sitting on 'confirmed' after the class
//                     ended. Nobody has said whether that child turned up.
//   assessment owed — a booking marked 'attended' with no skill_assessments row
//                     for that (player, session).
//
// Assessments are GATED BEHIND attendance, which is why they are counted this
// way round and not from the roster: an unmarked register has no attended
// bookings, so its assessment work does not exist yet and must not be counted
// as outstanding. Mark the register and the assessment debt appears — that is
// the real sequence, and the card should show it in that order too.
//
// 'no_show' is deliberately not chased for an assessment. You cannot rate a
// player who was not there, and the queue in the database does not ask anyone
// to.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type FollowThrough = {
  /** Bookings still on 'confirmed' — the register was never kept. */
  rosterUnmarked: number;
  /** Players marked attended that this session has no assessment for. */
  assessPending: number;
};

export const NO_FOLLOW_THROUGH: FollowThrough = { rosterUnmarked: 0, assessPending: 0 };

type BookingRow = { session_id: string; player_id: string | null; status: string };
type AssessmentRow = { session_id: string | null; player_id: string | null };

/**
 * Fold the two raw reads into one answer per session.
 *
 * Split out from the query so it can be tested without a database, and so the
 * page and the server action cannot end up counting differently — they had
 * already drifted once on session shape, which is why SessionRow is built in
 * two places at all.
 */
export function foldFollowThrough(
  bookings: BookingRow[],
  assessments: AssessmentRow[]
): Map<string, FollowThrough> {
  const assessed = new Set<string>();
  for (const a of assessments) {
    if (a.session_id && a.player_id) assessed.add(`${a.session_id}|${a.player_id}`);
  }
  const out = new Map<string, FollowThrough>();
  for (const b of bookings) {
    if (!b.session_id) continue;
    let row = out.get(b.session_id);
    if (!row) out.set(b.session_id, (row = { rosterUnmarked: 0, assessPending: 0 }));
    if (b.status === "confirmed") {
      row.rosterUnmarked++;
    } else if (b.status === "attended") {
      if (!b.player_id || !assessed.has(`${b.session_id}|${b.player_id}`)) row.assessPending++;
    }
  }
  return out;
}

/**
 * What each of these sessions still owes.
 *
 * Two reads rather than a view, because this has to work against the live
 * database today and every schema change here is applied to production by hand
 * (see AGENTS.md). Both are indexed lookups — `bookings_one_live_per_player`
 * and `skill_assessments_session_idx` — over one week of sessions.
 *
 * Sessions with nothing booked against them simply never appear in the map,
 * which is correct: a school class registered in the hall has no online
 * bookings and therefore no register to keep. Callers read misses as
 * NO_FOLLOW_THROUGH rather than as "unknown".
 */
export async function fetchFollowThrough(
  supabase: SupabaseClient<Database>,
  sessionIds: string[]
): Promise<Map<string, FollowThrough>> {
  if (sessionIds.length === 0) return new Map();
  const [{ data: bookings }, { data: assessments }] = await Promise.all([
    supabase
      .from("bookings")
      .select("session_id,player_id,status")
      .in("session_id", sessionIds)
      // Waitlisted and cancelled rows are not a roster: nobody owes an answer
      // about a child who was never given a place.
      .in("status", ["confirmed", "attended", "no_show"])
      .limit(5000),
    supabase
      .from("skill_assessments")
      .select("session_id,player_id")
      .in("session_id", sessionIds)
      .limit(5000),
  ]);
  return foldFollowThrough(
    (bookings ?? []) as BookingRow[],
    (assessments ?? []) as AssessmentRow[]
  );
}
