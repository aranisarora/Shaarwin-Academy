import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { CoachShell } from "@/components/app/CoachShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Clients" };

export default async function CoachClientsPage() {
  const { supabase, user } = await requireUser("/coach/clients");
  const coachId = await effectiveCoachId(user.id);

  // Players the coach actually coaches — via bookings on own sessions (RLS-safe).
  const { data: rows } = await supabase
    .from("bookings")
    .select("player_id,status,players(full_name,skill_level),class_sessions!inner(coach_id)")
    .eq("class_sessions.coach_id", coachId)
    .in("status", ["confirmed", "attended", "no_show"]);

  const unique = new Map<
    string,
    { id: string; name: string; level: string; sessions: number; attended: number; noShows: number }
  >();
  for (const row of rows ?? []) {
    const player = row.players as unknown as { full_name: string; skill_level: string } | null;
    if (!player) continue;
    const entry = unique.get(row.player_id) ?? {
      id: row.player_id,
      name: player.full_name,
      level: player.skill_level,
      sessions: 0,
      attended: 0,
      noShows: 0,
    };
    entry.sessions += 1;
    if (row.status === "attended") entry.attended += 1;
    if (row.status === "no_show") entry.noShows += 1;
    unique.set(row.player_id, entry);
  }

  const players = [...unique.values()].sort((a, b) => b.sessions - a.sessions);

  return (
    <CoachShell title="Clients">
      <div className="mx-auto max-w-2xl">
        {players.length === 0 ? (
          <EmptyState
            image="/images/empty-ivory.jpg"
            copy="Your players will appear here once sessions are booked."
          />
        ) : (
          <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
            {players.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/coach/clients/${p.id}`}
                  className="group flex items-center justify-between px-4 py-3 transition-colors"
                >
                  <div>
                    <p className="font-medium group-hover:text-ember">{p.name}</p>
                    <p className="tnum text-xs text-fg-2">
                      {p.sessions} session{p.sessions === 1 ? "" : "s"} with you
                      {p.attended > 0 && ` · ${p.attended} attended`}
                      {p.noShows > 0 && ` · ${p.noShows} no-shows`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{p.level}</Badge>
                    <span className="text-fg-2" aria-hidden>
                      ›
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CoachShell>
  );
}
