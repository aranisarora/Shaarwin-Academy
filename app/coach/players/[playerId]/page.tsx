import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { StudentNotes } from "@/components/app/StudentNotes";
import { StudentInsights } from "@/components/app/StudentInsights";
import { getStudentInsights } from "@/lib/student-insights";

export const metadata: Metadata = { title: "Student" };

export default async function CoachClientPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const { supabase, profile } = await requireUser(`/coach/players/${playerId}`);

  // RLS limits `players` to the coach's own roster (founder sees all), so a miss
  // here means the coach doesn't teach this player.
  const { data: player } = await supabase
    .from("players")
    .select("id,full_name,skill_level")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) notFound();

  // Bookings RLS scopes the insights to this coach's own sessions.
  const [insights, { data: notes }] = await Promise.all([
    getStudentInsights(supabase, playerId),
    supabase.rpc("get_player_notes", { p_player: playerId }),
  ]);

  const rows = (
    (notes as
      | { id: string; body: string; created_at: string; author_name: string }[]
      | null) ?? []
  ).map((n) => ({
    id: n.id,
    body: n.body,
    createdAt: n.created_at,
    author: n.author_name,
  }));

  return (
    <CoachShell title={player.full_name}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="flex items-center gap-3">
          <p className="font-display text-3xl">{player.full_name}</p>
          <Badge>{player.skill_level}</Badge>
        </div>

        <StudentInsights data={insights} />

        <div>
          <p className="label mb-3">Coach notes</p>
          <StudentNotes
            playerId={player.id}
            authorName={profile.full_name}
            notes={rows}
          />
        </div>
      </div>
    </CoachShell>
  );
}
