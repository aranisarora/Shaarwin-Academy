import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { StudentNotes } from "@/components/app/StudentNotes";
import { StudentInsights } from "@/components/app/StudentInsights";
import { getStudentInsights } from "@/lib/student-insights";

export const metadata: Metadata = { title: "Student" };

export default async function AdminStudentPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const { supabase, profile } = await requireUser(`/admin/players/${playerId}`);

  const { data: player } = await supabase
    .from("players")
    .select("id,full_name,skill_level,client_id,profiles(full_name,email)")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) notFound();

  const parent = player.profiles as unknown as {
    full_name: string;
    email: string;
  } | null;

  const [insights, { data: notes }] = await Promise.all([
    getStudentInsights(supabase, playerId),
    supabase.rpc("get_player_notes", { p_player: playerId }),
  ]);

  const noteRows = (
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
    <AdminShell title={player.full_name}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <div className="flex items-center gap-3">
            <p className="font-display text-3xl">{player.full_name}</p>
            <Badge>{player.skill_level}</Badge>
          </div>
          {parent && (
            <p className="mt-1 text-sm text-fg-2">
              Account:{" "}
              <Link href="/admin/players" className="text-ember hover:underline">
                {parent.full_name}
              </Link>{" "}
              · {parent.email}
            </p>
          )}
        </div>

        <StudentInsights data={insights} />

        <div>
          <p className="label mb-3">Coach notes</p>
          <StudentNotes
            playerId={player.id}
            authorName={profile.full_name}
            notes={noteRows}
          />
        </div>
      </div>
    </AdminShell>
  );
}
