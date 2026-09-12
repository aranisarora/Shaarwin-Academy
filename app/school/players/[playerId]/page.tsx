import type { Metadata } from "next";
import { cache, Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { SchoolShell } from "@/components/app/SchoolShell";
import { Badge } from "@/components/ui/Badge";
import { PageSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { StudentInsights } from "@/components/app/StudentInsights";
import { getStudentInsights } from "@/lib/student-insights";
import { getMasteryMap, masteryLabel } from "@/lib/mastery";
import { formatDateFull } from "@/lib/academy-time";

export const metadata: Metadata = { title: "Pupil" };

type Params = Promise<{ playerId: string }>;

/**
 * The parent's player page, for a school. One round trip, shared by the
 * streamed title and body through React `cache`.
 *
 * The reads are identical to `/app/players/[playerId]` because the school sees
 * what a parent sees — insights, notes and mastery are each scoped by RLS or by
 * the RPC's own authorisation check, so the select below is the ownership test
 * rather than a filter layered on top of one: a pupil at another campus, or one
 * belonging to a private client, simply returns no row and 404s.
 */
const loadPupil = cache(async (playerId: string) => {
  const { supabase } = await requireUser(`/school/players/${playerId}`);

  const [{ data: player }, insights, { data: notes }, masteryMap] = await Promise.all([
    supabase
      .from("players")
      .select("id,full_name,grade")
      .eq("id", playerId)
      .maybeSingle(),
    getStudentInsights(supabase, playerId),
    supabase.rpc("get_player_notes", { p_player: playerId }),
    getMasteryMap(supabase, [playerId]),
  ]);

  if (!player) notFound();

  return {
    player,
    insights,
    mastery: masteryMap.get(playerId) ?? 0,
    notes:
      (notes as
        | { id: string; body: string; created_at: string; author_name: string }[]
        | null) ?? [],
  };
});

async function PupilTitle({ params }: { params: Params }) {
  const { playerId } = await params;
  const { player } = await loadPupil(playerId);
  return <>{player.full_name}</>;
}

async function PupilBody({ params }: { params: Params }) {
  const { playerId } = await params;
  const { player, insights, mastery, notes } = await loadPupil(playerId);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-display text-3xl">{player.full_name}</p>
        <Badge tone="ember">{masteryLabel(mastery)}</Badge>
        <span className="tnum text-sm text-fg-2">{mastery}% mastery</span>
        {player.grade != null && (
          <span className="tnum text-sm text-fg-2">Grade {player.grade}</span>
        )}
      </div>

      <StudentInsights data={insights} />

      <div>
        <p className="label mb-3">Coach notes</p>
        {notes.length === 0 ? (
          <p className="text-sm text-fg-2">No notes from the coaches yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
            {notes.map((n) => (
              <li key={n.id} className="px-4 py-3">
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                <p className="tnum mt-1 text-xs text-fg-2">
                  {n.author_name} · {formatDateFull(n.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export default function SchoolPupilPage({ params }: { params: Params }) {
  return (
    <SchoolShell
      title={
        <Suspense fallback={<Skeleton className="h-6 w-32" />}>
          <PupilTitle params={params} />
        </Suspense>
      }
    >
      <div className="mx-auto max-w-2xl space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <PupilBody params={params} />
        </Suspense>
      </div>
    </SchoolShell>
  );
}
