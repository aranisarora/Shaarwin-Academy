import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ClientShell } from "@/components/app/ClientShell";
import { Badge } from "@/components/ui/Badge";
import { StudentInsights } from "@/components/app/StudentInsights";
import { getStudentInsights } from "@/lib/student-insights";
import { ACADEMY_TZ } from "@/lib/academy-time";

export const metadata: Metadata = { title: "Player" };

function fmtNoteDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: ACADEMY_TZ,
  }).format(new Date(iso));
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const { supabase, user } = await requireUser(`/app/players/${playerId}`);

  // Scope to the parent's own household — a miss means it's not their player.
  const { data: player } = await supabase
    .from("players")
    .select("id,full_name,skill_level")
    .eq("id", playerId)
    .eq("client_id", user.id)
    .maybeSingle();
  if (!player) notFound();

  // Bookings RLS scopes insights to this parent's own bookings; the notes RPC
  // authorises the player's parent alongside coaches.
  const [insights, { data: notes }] = await Promise.all([
    getStudentInsights(supabase, playerId),
    supabase.rpc("get_player_notes", { p_player: playerId }),
  ]);

  const noteRows =
    (notes as
      | { id: string; body: string; created_at: string; author_name: string }[]
      | null) ?? [];

  return (
    <ClientShell title={player.full_name}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="flex items-center gap-3">
          <p className="font-display text-3xl">{player.full_name}</p>
          <Badge>{player.skill_level}</Badge>
        </div>

        <StudentInsights data={insights} />

        <div>
          <p className="label mb-3">Coach notes</p>
          {noteRows.length === 0 ? (
            <p className="text-sm text-fg-2">No notes from the coaches yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
              {noteRows.map((n) => (
                <li key={n.id} className="px-4 py-3">
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  <p className="tnum mt-1 text-xs text-fg-2">
                    {n.author_name} · {fmtNoteDate(n.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ClientShell>
  );
}
