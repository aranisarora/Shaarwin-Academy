import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { StudentNotes } from "@/components/app/StudentNotes";

export const metadata: Metadata = { title: "Student" };

export default async function CoachClientPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const { supabase, profile } = await requireUser(`/coach/clients/${playerId}`);

  // RLS limits `players` to the coach's own roster (founder sees all), so a miss
  // here means the coach doesn't teach this player.
  const { data: player } = await supabase
    .from("players")
    .select("id,full_name,skill_level")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) notFound();

  const { data: notes } = await supabase.rpc("get_player_notes", {
    p_player: playerId,
  });

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
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <p className="font-display text-3xl">{player.full_name}</p>
          <Badge>{player.skill_level}</Badge>
        </div>

        <StudentNotes
          playerId={player.id}
          authorName={profile.full_name}
          notes={rows}
        />
      </div>
    </CoachShell>
  );
}
