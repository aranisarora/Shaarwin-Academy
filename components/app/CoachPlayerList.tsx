"use client";

// The coach's roster. One line per player — name, a session summary, mastery —
// with the detail living on the player page. Once the list runs past ~10, a
// search box appears so a coach can find a name without scrolling (same pattern
// as the admin Players list).

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { masteryLabel } from "@/lib/mastery";

export type CoachPlayer = {
  id: string;
  name: string;
  sessions: number;
  attended: number;
  noShows: number;
  mastery: number;
};

export function CoachPlayerList({ players }: { players: CoachPlayer[] }) {
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
              href={`/coach/players/${p.id}`}
              className="group flex items-center justify-between px-4 py-3 transition-colors"
            >
              <div>
                <p className="font-medium group-hover:text-ember">{p.name}</p>
                <p className="tnum text-xs text-fg-2">
                  {p.sessions} session{p.sessions === 1 ? "" : "s"} with you
                  {p.attended > 0 && ` · ${p.attended} attended`}
                  {p.noShows > 0 && ` · ${p.noShows} no-shows`}
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
