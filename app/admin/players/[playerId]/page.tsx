import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { StudentNotes } from "@/components/app/StudentNotes";
import { StudentInsights } from "@/components/app/StudentInsights";
import { SkillRatingsView } from "@/components/app/SkillRatingsView";
import { getStudentInsights } from "@/lib/student-insights";
import { getMasteryMap } from "@/lib/mastery";

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

  const [insights, { data: notes }, { data: categories }, { data: skills }, { data: ratingRows }, masteryMap] =
    await Promise.all([
      getStudentInsights(supabase, playerId),
      supabase.rpc("get_player_notes", { p_player: playerId }),
      supabase.from("skill_categories").select("id,name").order("sort_order").order("created_at"),
      supabase
        .from("skills")
        .select("id,category_id,name")
        .eq("active", true)
        .order("sort_order")
        .order("created_at"),
      supabase.from("latest_skill_ratings").select("skill_id,rating").eq("player_id", playerId),
      getMasteryMap(supabase, [playerId]),
    ]);

  const mastery = masteryMap.get(playerId) ?? 0;
  const ratings = new Map<string, number>();
  for (const r of (ratingRows as { skill_id: string; rating: number }[] | null) ?? []) {
    ratings.set(r.skill_id, r.rating);
  }

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

        <div className="space-y-4">
          <p className="label">Skills</p>
          <SkillRatingsView
            mastery={mastery}
            categories={categories ?? []}
            skills={skills ?? []}
            ratings={ratings}
          />
        </div>

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
