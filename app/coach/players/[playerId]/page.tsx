import type { Metadata } from "next";
import { cache, Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { PageSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { StudentNotes } from "@/components/app/StudentNotes";
import { StudentInsights } from "@/components/app/StudentInsights";
import { SkillRatingsView } from "@/components/app/SkillRatingsView";
import { AssessmentEditor } from "@/components/app/AssessmentEditor";
import { getStudentInsights } from "@/lib/student-insights";
import { getMasteryMap, masteryLabel } from "@/lib/mastery";

export const metadata: Metadata = { title: "Student" };

type Params = Promise<{ playerId: string }>;
type SearchParams = Promise<{ session?: string }>;

/**
 * Everything this screen reads, in one round trip. Wrapped in React `cache` so
 * the streamed header title and the body share it rather than each querying.
 *
 * The player row used to be fetched on its own, ahead of the batch below, but
 * nothing in that batch needs it — they all key off `playerId`, which is known
 * from the URL — so it joins the same `Promise.all` and the screen costs one
 * round trip instead of two.
 */
const loadPlayer = cache(async (playerId: string, sessionId: string | undefined) => {
  const { supabase, profile } = await requireUser(`/coach/players/${playerId}`);

  // Bookings RLS scopes the insights to this coach's own sessions.
  const [
    { data: player },
    insights,
    { data: notes },
    { data: categories },
    { data: skills },
    { data: ratingRows },
    masteryMap,
    sessionInfo,
  ] = await Promise.all([
    // RLS limits `players` to the coach's own roster (founder sees all), so a
    // miss here means the coach doesn't teach this player.
    supabase.from("players").select("id,full_name").eq("id", playerId).maybeSingle(),
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

  if (!player) notFound();

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

  return {
    player,
    profile,
    insights,
    categories: categories ?? [],
    skills: skills ?? [],
    ratings,
    ratingRecord,
    mastery,
    classTitle,
    notes: rows,
  };
});

async function PlayerTitle({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ playerId }, { session }] = await Promise.all([params, searchParams]);
  const { player } = await loadPlayer(playerId, session);
  return <>{player.full_name}</>;
}

async function PlayerBody({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ playerId }, { session: sessionId }] = await Promise.all([params, searchParams]);
  const {
    player,
    profile,
    insights,
    categories,
    skills,
    ratings,
    ratingRecord,
    mastery,
    classTitle,
    notes,
  } = await loadPlayer(playerId, sessionId);

  return (
    <>
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
          categories={categories}
          skills={skills}
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
            categories={categories}
            skills={skills}
            initialRatings={ratingRecord}
          />
        </div>
      </div>

      <div>
        <p className="label mb-3">Coach notes</p>
        <StudentNotes
          playerId={player.id}
          authorName={profile.full_name}
          notes={notes}
        />
      </div>
    </>
  );
}

export default function CoachClientPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return (
    <CoachShell
      title={
        <Suspense fallback={<Skeleton className="h-6 w-32" />}>
          <PlayerTitle params={params} searchParams={searchParams} />
        </Suspense>
      }
    >
      <div className="mx-auto max-w-2xl space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <PlayerBody params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </CoachShell>
  );
}
