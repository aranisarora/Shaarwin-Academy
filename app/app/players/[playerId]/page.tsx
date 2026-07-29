import type { Metadata } from "next";
import { cache, Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ClientShell } from "@/components/app/ClientShell";
import { Badge } from "@/components/ui/Badge";
import { PageSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { StudentInsights } from "@/components/app/StudentInsights";
import { getStudentInsights } from "@/lib/student-insights";
import { getMasteryMap, masteryLabel } from "@/lib/mastery";
import { formatDateFull } from "@/lib/academy-time";

export const metadata: Metadata = { title: "Player" };

type Params = Promise<{ playerId: string }>;

/**
 * One round trip, shared by the streamed title and body through React `cache`.
 * The ownership check used to be awaited ahead of the batch below, but nothing
 * in the batch reads its result — insights, notes and mastery all key off
 * `playerId` from the URL, and each is scoped by RLS in its own right — so it
 * joins the same `Promise.all`.
 */
const loadPlayer = cache(async (playerId: string) => {
  const { supabase, user } = await requireUser(`/app/players/${playerId}`);

  // Bookings RLS scopes insights to this parent's own bookings; the notes RPC
  // authorises the player's parent alongside coaches.
  const [{ data: player }, insights, { data: notes }, masteryMap] = await Promise.all([
    // Scope to the parent's own household — a miss means it's not their player.
    supabase
      .from("players")
      .select("id,full_name")
      .eq("id", playerId)
      .eq("client_id", user.id)
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

async function PlayerTitle({ params }: { params: Params }) {
  const { playerId } = await params;
  const { player } = await loadPlayer(playerId);
  return <>{player.full_name}</>;
}

async function PlayerBody({ params }: { params: Params }) {
  const { playerId } = await params;
  const { player, insights, mastery, notes } = await loadPlayer(playerId);

  return (
    <>
      <div className="flex items-center gap-3">
        <p className="font-display text-3xl">{player.full_name}</p>
        <Badge tone="ember">{masteryLabel(mastery)}</Badge>
        <span className="tnum text-sm text-fg-2">{mastery}% mastery</span>
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

export default function PlayerPage({ params }: { params: Params }) {
  return (
    <ClientShell
      title={
        <Suspense fallback={<Skeleton className="h-6 w-32" />}>
          <PlayerTitle params={params} />
        </Suspense>
      }
    >
      <div className="mx-auto max-w-2xl space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <PlayerBody params={params} />
        </Suspense>
      </div>
    </ClientShell>
  );
}
