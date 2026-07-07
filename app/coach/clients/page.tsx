import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Clients" };

export default async function CoachClientsPage() {
  const { supabase, user } = await requireUser("/coach/clients");

  // Players the coach actually coaches — via bookings on own sessions (RLS-safe).
  const { data: rows } = await supabase
    .from("bookings")
    .select("player_id,players(full_name,skill_level),class_sessions!inner(coach_id)")
    .eq("class_sessions.coach_id", user.id)
    .in("status", ["confirmed", "attended", "no_show"]);

  const unique = new Map<string, { name: string; level: string; sessions: number }>();
  for (const row of rows ?? []) {
    const player = row.players as unknown as { full_name: string; skill_level: string } | null;
    if (!player) continue;
    const entry = unique.get(row.player_id) ?? {
      name: player.full_name,
      level: player.skill_level,
      sessions: 0,
    };
    entry.sessions += 1;
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
              <li key={p.name} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="tnum text-xs text-fg-2">
                    {p.sessions} session{p.sessions === 1 ? "" : "s"} with you
                  </p>
                </div>
                <Badge>{p.level}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CoachShell>
  );
}
