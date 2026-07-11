"use client";

import { useMemo, useState } from "react";
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

const LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const;

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
};

const LEVEL_TONE: Record<string, "neutral" | "ok" | "ember"> = {
  beginner: "neutral",
  intermediate: "ok",
  advanced: "ember",
  elite: "ember",
};

function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level;
}

function ageYears(dob: string): number {
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function PlayerManager({ players }: { players: PlayerRow[] }) {
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlayerRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter(
      (p) =>
        (level === null || p.skillLevel === level) &&
        (q === "" ||
          p.name.toLowerCase().includes(q) ||
          p.clientName.toLowerCase().includes(q) ||
          p.clientEmail.toLowerCase().includes(q))
    );
  }, [players, search, level]);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-fg-2">
          Every household player across all client accounts.
        </p>
        <span className="tnum shrink-0 text-sm text-fg-2">
          {filtered.length} of {players.length}
        </span>
      </div>

      <Input
        placeholder="Search by player or client…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <FilterChip
          label="All"
          active={level === null}
          onClick={() => setLevel(null)}
        />
        {LEVELS.map((l) => (
          <FilterChip
            key={l}
            label={LEVEL_LABELS[l]}
            active={level === l}
            onClick={() => setLevel(level === l ? null : l)}
          />
        ))}
      </div>

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {filtered.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => setSelected(p)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface"
            >
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-sm font-medium text-fg-2"
              >
                {initials(p.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="truncate text-sm text-fg-2">{p.clientName}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={LEVEL_TONE[p.skillLevel]}>{levelLabel(p.skillLevel)}</Badge>
                {p.dateOfBirth && (
                  <span className="tnum text-xs text-fg-2">
                    {ageYears(p.dateOfBirth)}y
                  </span>
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
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-2 text-base font-medium text-fg-2"
              >
                {initials(selected.name)}
              </span>
              <div>
                <Badge tone={LEVEL_TONE[selected.skillLevel]}>
                  {levelLabel(selected.skillLevel)}
                </Badge>
                {selected.dateOfBirth && (
                  <p className="tnum mt-1 text-sm text-fg-2">
                    {new Date(selected.dateOfBirth).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}{" "}
                    · {ageYears(selected.dateOfBirth)} yrs
                  </p>
                )}
              </div>
            </div>

            {selected.notes && (
              <div className="space-y-1">
                <p className="label">Notes</p>
                <p className="text-sm">{selected.notes}</p>
              </div>
            )}

            <div className="space-y-2 rounded-[12px] border border-line p-4">
              <p className="label">Account holder</p>
              <p className="font-medium">{selected.clientName}</p>
              {selected.clientEmail?.endsWith("@sharwin.local") ? (
                <p className="text-sm text-fg-2">Registered via phone — no email on file</p>
              ) : (
                <p className="text-sm text-fg-2">{selected.clientEmail}</p>
              )}
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

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
        active
          ? "border-ember bg-ember/10 text-ember"
          : "border-line text-fg-2 hover:bg-surface-2"
      }`}
    >
      {label}
    </button>
  );
}
