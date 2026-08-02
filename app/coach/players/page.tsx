import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { CoachShell } from "@/components/app/CoachShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { PlayerRoster } from "@/components/app/PlayerRoster";
import { getMasteryMap } from "@/lib/mastery";

export const metadata: Metadata = { title: "Players" };

/** Streamed under the shell — the roll-up needs auth, the chrome does not. */
async function PlayerList() {
  const { supabase, user } = await requireUser("/coach/players");
  const coachId = await effectiveCoachId(user.id);

  // Players the coach actually coaches — via bookings on own sessions (RLS-safe).
  // Nothing here can overlap: the mastery lookup below needs the player ids this
  // query returns.
  const { data: rows } = await supabase
    .from("bookings")
    .select("player_id,status,players(full_name),class_sessions!inner(coach_id)")
    .eq("class_sessions.coach_id", coachId)
    .in("status", ["confirmed", "attended", "no_show"]);

  const unique = new Map<
    string,
    { id: string; name: string; sessions: number; attended: number; noShows: number }
  >();
  for (const row of rows ?? []) {
    const player = row.players;
    if (!player) continue;
    const entry = unique.get(row.player_id) ?? {
      id: row.player_id,
      name: player.full_name,
      sessions: 0,
      attended: 0,
      noShows: 0,
    };
    entry.sessions += 1;
    if (row.status === "attended") entry.attended += 1;
    if (row.status === "no_show") entry.noShows += 1;
    unique.set(row.player_id, entry);
  }

  const masteryMap = await getMasteryMap(supabase, [...unique.keys()]);
  const players = [...unique.values()]
    .map((p) => ({ ...p, mastery: masteryMap.get(p.id) ?? 0 }))
    .sort((a, b) => b.sessions - a.sessions);

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
