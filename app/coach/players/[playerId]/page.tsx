import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { StudentNotes } from "@/components/app/StudentNotes";
import { StudentInsights } from "@/components/app/StudentInsights";
import { SkillRatingsView } from "@/components/app/SkillRatingsView";
import { AssessmentEditor } from "@/components/app/AssessmentEditor";
import { getStudentInsights } from "@/lib/student-insights";
import { getMasteryMap, masteryLabel } from "@/lib/mastery";

export const metadata: Metadata = { title: "Student" };

export default async function CoachClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { playerId } = await params;
  const { session: sessionId } = await searchParams;
  const { supabase, profile } = await requireUser(`/coach/players/${playerId}`);

  // RLS limits `players` to the coach's own roster (founder sees all), so a miss
  // here means the coach doesn't teach this player.
  const { data: player } = await supabase
    .from("players")
    .select("id,full_name")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) notFound();

  // Bookings RLS scopes the insights to this coach's own sessions.
  const [insights, { data: notes }, { data: categories }, { data: skills }, { data: ratingRows }, masteryMap, sessionInfo] =
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
      sessionId
        ? supabase
            .from("class_sessions")
            .select("classes(title)")
            .eq("id", sessionId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const mastery = masteryMap.get(playerId) ?? 0;
  const ratings = new Map<string, number>();
  const ratingRecord: Record<string, number> = {};
  for (const r of (ratingRows as { skill_id: string; rating: number }[] | null) ?? []) {
    ratings.set(r.skill_id, r.rating);
    ratingRecord[r.skill_id] = r.rating;
  }

  const classTitle =
    ((sessionInfo?.data as { classes: { title: string } | null } | null)?.classes?.title) ?? null;

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
          <Badge tone="ember">
            {mastery}% · {masteryLabel(mastery)}
          </Badge>
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
          <div className="rounded-[12px] border border-line bg-surface p-4">
            <p className="mb-3 font-medium">
              {sessionId ? "Complete assessment" : "New assessment"}
            </p>
            <AssessmentEditor
              playerId={player.id}
              sessionId={sessionId ?? null}
              classTitle={classTitle}
              categories={categories ?? []}
              skills={skills ?? []}
              initialRatings={ratingRecord}
            />
          </div>
        </div>

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
