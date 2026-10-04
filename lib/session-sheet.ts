import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Supabase = SupabaseClient<Database>;

export type RosterEntry = {
  id: string;
  name: string;
  /** "attended" = present, "no_show" = absent, "confirmed" = unmarked,
   *  "waitlisted" = holding a place in the queue, not in the class. */
  status: "confirmed" | "attended" | "no_show" | "waitlisted";
  /** Where in the queue, for a waitlisted booking. Null for everyone else. */
  waitlistPosition: number | null;
};

/**
 * Who's booked on a session and whether they were marked present or absent —
 * shown in the admin session sheet.
 *
 * The waitlist is opt-in per caller, and deliberately so: the weekly class
 * sheet asks this same question to list "Regulars", and a queue appearing in
 * that list would be answering a question nobody asked there.
 */
export async function readRoster(
  supabase: Supabase,
  sessionId: string,
  includeWaitlisted: boolean
): Promise<RosterEntry[]> {
  const statuses: RosterEntry["status"][] = includeWaitlisted
    ? ["confirmed", "attended", "no_show", "waitlisted"]
    : ["confirmed", "attended", "no_show"];
  const { data } = await supabase
    .from("bookings")
    .select("id,status,waitlist_position,players(full_name)")
    .eq("session_id", sessionId)
    .in("status", statuses);
  return (data ?? [])
    .map((b) => ({
      id: b.id,
      name: b.players?.full_name ?? "Unknown player",
      status: b.status as RosterEntry["status"],
      waitlistPosition: b.waitlist_position ?? null,
    }))
    .sort((a, b) => {
      // Booked first, then the queue in its own order — a waitlisted name
      // sorted alphabetically among the booked would read as being in.
      const aQ = a.status === "waitlisted";
      const bQ = b.status === "waitlisted";
      if (aQ !== bQ) return aQ ? 1 : -1;
      if (aQ && bQ) return (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0);
      return a.name.localeCompare(b.name);
    });
}

/**
 * The facts about one session that aren't already on the calendar row — the
 * coach's name, what he has said and done about turning up, anything he wrote
 * afterwards, and how many places were given back.
 *
 * Kept off `SessionRow` on purpose. That row is fetched for every session in a
 * week, so widening it to serve one open sheet would put all of this on a
 * phone's wire for sessions nobody is looking at.
 */
export type SessionDetail = {
  status: "scheduled" | "completed" | "cancelled";
  coachName: string | null;
  coachConfirmedAt: string | null;
  coachNotes: string | null;
  cancelReason: string | null;
  /** Places that were held and given back — the ones the roster can't show. */
  cancelledCount: number;
};

export async function readSessionDetail(
  supabase: Supabase,
  sessionId: string
): Promise<SessionDetail | null> {
  // The coach's name comes through `coaches` rather than the sheet's `coaches`
  // prop, which is filtered to active coaches — a session still rostered to a
  // coach who has since been paused would otherwise show no name at all.
  const [{ data: s }, { count }] = await Promise.all([
    supabase
      .from("class_sessions")
      .select("status,coach_notes,coach_confirmed_at,cancel_reason,coaches(profiles(full_name))")
      .eq("id", sessionId)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .in("status", ["cancelled_by_client", "cancelled_by_academy"]),
  ]);
  if (!s) return null;

  return {
    status: s.status as SessionDetail["status"],
    coachName: s.coaches?.profiles.full_name ?? null,
    coachConfirmedAt: s.coach_confirmed_at,
    coachNotes: s.coach_notes,
    cancelReason: s.cancel_reason,
    cancelledCount: count ?? 0,
  };
}

export type RankedCoach = { coachId: string; name: string; score: number };

export async function readRankedCoaches(
  supabase: Supabase,
  sessionId: string
): Promise<RankedCoach[]> {
  const { data: rows } = await supabase.rpc("rank_coaches", { p_session: sessionId });
  if (!rows || rows.length === 0) return [];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,full_name")
    .in(
      "id",
      rows.map((r) => r.coach_id)
    );
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  return rows.map((r) => ({
    coachId: r.coach_id,
    name: names.get(r.coach_id) ?? "Coach",
    score: Number(r.score),
  }));
}
