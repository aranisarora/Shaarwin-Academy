"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";

type PlayerRow = {
  id: string;
  name: string;
  skillLevel: string;
  dateOfBirth: string | null;
  notes: string | null;
  createdAt: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
};

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

function age(dob: string): string {
  const d = new Date(dob);
  const a = Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
  return `${a}y`;
}

export function PlayerManager({ players }: { players: PlayerRow[] }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PlayerRow | null>(null);

  const filtered = players.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.clientName.toLowerCase().includes(search.toLowerCase()) ||
      p.clientEmail.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-2">
        All household players across every client account.
      </p>
      <Input
        placeholder="Search by player or client…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {filtered.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => setSelected(p)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
            >
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-sm text-fg-2">{p.clientName}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge>{LEVEL_LABELS[p.skillLevel] ?? p.skillLevel}</Badge>
                {p.dateOfBirth && (
                  <span className="text-xs text-fg-2">{age(p.dateOfBirth)}</span>
                )}
              </div>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-fg-2">No matches.</li>
        )}
      </ul>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name}
      >
        {selected && (
          <div className="space-y-6">
            <div className="space-y-1">
              <p className="label">Skill level</p>
              <Badge>{LEVEL_LABELS[selected.skillLevel] ?? selected.skillLevel}</Badge>
            </div>

            {selected.dateOfBirth && (
              <div className="space-y-1">
                <p className="label">Date of birth</p>
                <p className="tnum text-sm">
                  {new Date(selected.dateOfBirth).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  <span className="text-fg-2">({age(selected.dateOfBirth)} old)</span>
                </p>
              </div>
            )}

            {selected.notes && (
              <div className="space-y-1">
                <p className="label">Notes</p>
                <p className="text-sm">{selected.notes}</p>
              </div>
            )}

            <div className="space-y-2 rounded-[12px] border border-line p-4">
              <p className="label">Account holder</p>
              <p className="font-medium">{selected.clientName}</p>
              <p className="text-sm text-fg-2">{selected.clientEmail}</p>
              {selected.clientPhone && (
                <p className="text-sm text-fg-2">{selected.clientPhone}</p>
              )}
            </div>

            <Link
              href={`/admin/clients/${selected.id}`}
              className="block rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-center text-sm font-medium hover:bg-surface"
            >
              View player profile →
            </Link>
          </div>
        )}
      </Sheet>
    </div>
  );
}
