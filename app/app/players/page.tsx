import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMyBookings } from "@/lib/booking";
import { formatSessionDate, nowMs } from "@/lib/academy-time";
import { ClientShell } from "@/components/app/ClientShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { getMasteryMap, masteryLabel } from "@/lib/mastery";

export const metadata: Metadata = { title: "Players" };

/** Streamed under the shell — the roster needs auth, the chrome does not. */
async function Roster() {
  const { supabase, user } = await requireUser("/app/players");
  const [{ data: players }, bookings] = await Promise.all([
    supabase
      .from("players")
      .select("id,full_name")
      .eq("client_id", user.id)
      .order("created_at"),
    getMyBookings(supabase, user.id),
  ]);
  // A second trip by necessity: it needs the player ids the query above returns.
  const masteryMap = await getMasteryMap(
    supabase,
    (players ?? []).map((p) => p.id)
  );

  const now = nowMs();
  const nextByPlayer = new Map<string, string>();
  const attendedByPlayer = new Map<string, number>();
  for (const b of bookings) {
    if (!b.playerId) continue;
    const starts = new Date(b.session.starts_at).getTime();
    if (
      ["confirmed", "waitlisted"].includes(b.status) &&
      starts > now &&
      !nextByPlayer.has(b.playerId)
    ) {
      nextByPlayer.set(b.playerId, b.session.starts_at);
    }
    if (b.status === "attended") {
      attendedByPlayer.set(b.playerId, (attendedByPlayer.get(b.playerId) ?? 0) + 1);
    }
  }

  return (
    <>
      {(players ?? []).length === 0 ? (
        <EmptyState
          copy="No players yet — add who'll be at the table."
          action={<ButtonLink href="/app/profile">Add a player</ButtonLink>}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {(players ?? []).map((p) => {
              const next = nextByPlayer.get(p.id);
              const attended = attendedByPlayer.get(p.id) ?? 0;
              const mastery = masteryMap.get(p.id) ?? 0;
              return (
                <li key={p.id}>
                  <Link
                    href={`/app/players/${p.id}`}
                    className="block rounded-[12px] border border-line bg-surface-2 p-5 transition-colors hover:border-ember"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-display text-2xl">{p.full_name}</p>
                      <div className="flex items-center gap-2">
                        <span className="tnum text-sm text-fg-2">{mastery}%</span>
                        <Badge tone="ember">{masteryLabel(mastery)}</Badge>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-fg-2">
                      {next
                        ? `Next session ${formatSessionDate(next)}`
                        : "Nothing booked yet"}
                      {attended > 0
                        ? ` · ${attended} session${attended === 1 ? "" : "s"} played`
                        : ""}
                    </p>
                    <p className="mt-1 text-sm text-ember">
                      Attendance, progress &amp; coach notes →
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-fg-2">
            Someone new joining?{" "}
            <Link
              href="/app/profile"
              className="text-ember underline-offset-4 hover:underline"
            >
              Add a player
            </Link>
            .
          </p>
        </>
      )}
    </>
  );
}

export default function PlayersPage() {
  return (
    <ClientShell title="Players">
      <div className="mx-auto max-w-2xl space-y-4">
        <Suspense fallback={<PageSkeleton />}>
          <Roster />
        </Suspense>
      </div>
    </ClientShell>
  );
}
