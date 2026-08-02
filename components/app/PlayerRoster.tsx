"use client";

// A roster of players — one line each: name, a one-line summary, mastery — with
// the detail living on the player page. Once the list runs past ~10, a search
// box appears so a name can be found without scrolling (same pattern as the
// admin Players list).
//
// Shared by the coach's roster (/coach/players) and the school's (/school).
// They differ only in where a row links and what the summary line says, so both
// are props: `meta` is a precomputed string rather than a formatter, because a
// Server Component cannot hand a function to a Client Component.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { masteryLabel } from "@/lib/mastery";

export type RosterPlayer = {
  id: string;
  name: string;
  sessions: number;
  attended: number;
  noShows: number;
  mastery: number;
  /** Overrides the default summary line. */
  meta?: string;
};

export function PlayerRoster({
  players,
  hrefBase = "/coach/players",
}: {
  players: RosterPlayer[];
  hrefBase?: string;
}) {
  const [search, setSearch] = useState("");
  const showSearch = players.length > 10;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q === "" ? players : players.filter((p) => p.name.toLowerCase().includes(q));
  }, [players, search]);

  return (
    <div className="space-y-4">
      {showSearch && (
        <Input
          placeholder="Search players…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {filtered.map((p) => (
          <li key={p.id}>
            <Link
              href={`${hrefBase}/${p.id}`}
              className="group flex items-center justify-between px-4 py-3 transition-colors"
            >
              <div>
                <p className="font-medium group-hover:text-ember">{p.name}</p>
                <p className="tnum text-xs text-fg-2">
                  {p.meta ?? (
                    <>
                      {p.sessions} session{p.sessions === 1 ? "" : "s"} with you
                      {p.attended > 0 && ` · ${p.attended} attended`}
                      {p.noShows > 0 && ` · ${p.noShows} no-shows`}
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="tnum text-sm text-fg-2">{p.mastery}%</span>
                <Badge>{masteryLabel(p.mastery)}</Badge>
                <span className="text-fg-2" aria-hidden>
                  ›
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
