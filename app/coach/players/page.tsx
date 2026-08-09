import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { CoachShell } from "@/components/app/CoachShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { PlayerRoster, type RosterPlayer } from "@/components/app/PlayerRoster";
import { getMasteryMap } from "@/lib/mastery";

export const metadata: Metadata = { title: "Players" };

type Entry = {
  id: string;
  name: string;
  sessions: number;
  attended: number;
  noShows: number;
  /** Campus name, for a pupil the coach hasn't personally taught yet. */
  school: string | null;
};

/** Streamed under the shell — the roll-up needs auth, the chrome does not. */
async function PlayerList() {
  const { supabase, user } = await requireUser("/coach/players");
  const coachId = await effectiveCoachId(user.id);

  // Two sources, deliberately. Bookings on the coach's own sessions are the
  // players they have actually stood in front of, and carry the attendance
  // counts. The school half is everyone else on a campus they teach at:
  // add_school_player only books a pupil onto sessions from the one they were
  // added to onwards, so a coach who picked the class up later had a roster
  // missing pupils they'd be teaching that week. RLS agrees with both halves
  // (`coach_has_player` and `coach_teaches_school_of`, 0076).
  const [{ data: rows }, { data: venues }] = await Promise.all([
    supabase
      .from("bookings")
      .select("player_id,status,players(full_name),class_sessions!inner(coach_id)")
      .eq("class_sessions.coach_id", coachId)
      .in("status", ["confirmed", "attended", "no_show"]),
    supabase.rpc("coach_school_venues"),
  ]);

  const unique = new Map<string, Entry>();
  for (const row of rows ?? []) {
    const player = row.players;
    if (!player) continue;
    const entry = unique.get(row.player_id) ?? {
      id: row.player_id,
      name: player.full_name,
      sessions: 0,
      attended: 0,
      noShows: 0,
      school: null,
    };
    entry.sessions += 1;
    if (row.status === "attended") entry.attended += 1;
    if (row.status === "no_show") entry.noShows += 1;
    unique.set(row.player_id, entry);
  }

  const campuses = venues ?? [];
  if (campuses.length > 0) {
    const { data: pupils } = await supabase
      .from("players")
      .select("id,full_name,school_venue_id")
      .in(
        "school_venue_id",
        campuses.map((v) => v.venue_id)
      )
      .is("client_id", null);
    const venueName = new Map(campuses.map((v) => [v.venue_id, v.venue_name]));
    for (const p of pupils ?? []) {
      // A pupil already booked onto one of the coach's own sessions keeps the
      // richer row — the counts are real there and 0 would read as a lie.
      if (unique.has(p.id)) continue;
      unique.set(p.id, {
        id: p.id,
        name: p.full_name,
        sessions: 0,
        attended: 0,
        noShows: 0,
        school: venueName.get(p.school_venue_id ?? "") ?? "their school",
      });
    }
  }

  const masteryMap = await getMasteryMap(supabase, [...unique.keys()]);
  const players: RosterPlayer[] = [...unique.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      sessions: p.sessions,
      attended: p.attended,
      noShows: p.noShows,
      mastery: masteryMap.get(p.id) ?? 0,
      // Saying "0 sessions with you" to a coach who is about to teach the whole
      // class reads as an error. Name the campus instead.
      meta: p.school ? `${p.school} · not in your sessions yet` : undefined,
    }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

  return players.length === 0 ? (
    <EmptyState
      image="/images/empty-ivory.jpg"
      copy="Your players will appear here once sessions are booked."
    />
  ) : (
    <PlayerRoster players={players} />
  );
}

export default function CoachPlayersPage() {
  return (
    <CoachShell title="Players">
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <PlayerList />
        </Suspense>
      </div>
    </CoachShell>
  );
}
