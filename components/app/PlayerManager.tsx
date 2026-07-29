"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { formatWallDateFull } from "@/lib/academy-time";
import { masteryLabel } from "@/lib/mastery";

type PlayerRow = {
  id: string;
  name: string;
  skillLevel: string;
  mastery: number;
  dateOfBirth: string | null;
  notes: string | null;
  createdAt: string;
  clientId: string | null;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  school?: string | null;
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

function isPhoneOnly(email: string): boolean {
  return email.endsWith("@sharwin.local") || email === "";
}

/** Auto-provisioned accounts carry placeholder player names until the person
 *  fills in their profile — treat those as "no name yet". */
function isRealName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n !== "" && n !== "there" && n !== "player";
}

/** Best available label for the row title: player → client → phone. */
function displayName(row: PlayerRow): string {
  if (isRealName(row.name)) return row.name;
  if (isRealName(row.clientName)) return row.clientName;
  return row.clientPhone ?? "New member";
}

function clientSubline(row: PlayerRow): string {
  // School players have no account holder — show the school they attend.
  if (row.school) return `${row.school} · school player`;
  const parts: string[] = [];
  if (isRealName(row.clientName) && row.clientName !== displayName(row))
    parts.push(row.clientName);
  if (isPhoneOnly(row.clientEmail)) {
    if (row.clientPhone && row.clientPhone !== displayName(row)) parts.push(row.clientPhone);
    if (parts.length === 0) return "Signed up by phone";
  } else if (row.clientEmail) {
    parts.push(row.clientEmail);
  }
  return parts.join(" · ");
}

function PhoneGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

/** Initials avatar when we have a real name; ember-tinted phone glyph when the
 *  account only has a number. */
function Avatar({ row, size }: { row: PlayerRow; size: "sm" | "lg" }) {
  const dims = size === "sm" ? "h-10 w-10 text-sm" : "h-12 w-12 text-base";
  const label = displayName(row);
  if (isRealName(row.name) || isRealName(row.clientName)) {
    return (
      <span
        aria-hidden
        className={`grid ${dims} shrink-0 place-items-center rounded-full bg-surface font-medium text-fg-2`}
      >
        {initials(label)}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`grid ${dims} shrink-0 place-items-center rounded-full bg-ember/10 text-ember`}
    >
      <PhoneGlyph className={size === "sm" ? "h-5 w-5" : "h-6 w-6"} />
    </span>
  );
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
          p.clientEmail.toLowerCase().includes(q) ||
          (p.clientPhone ?? "").toLowerCase().includes(q) ||
          (p.school ?? "").toLowerCase().includes(q))
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
              <Avatar row={p} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{displayName(p)}</p>
                <p className="truncate text-sm text-fg-2">{clientSubline(p)}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="tnum text-sm text-fg-2">{p.mastery}%</span>
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
          <li className="px-4 py-6 text-center text-sm text-fg-2">
            {players.length === 0
              ? "Players appear here as clients add them, or when you enrol a school pupil. Nothing to do yet."
              : "No matches."}
          </li>
        )}
      </ul>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? displayName(selected) : undefined}
      >
        {selected && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Avatar row={selected} size="lg" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="tnum text-lg font-medium">{selected.mastery}%</span>
                  <Badge tone="ember">{masteryLabel(selected.mastery)}</Badge>
                  <Badge tone={LEVEL_TONE[selected.skillLevel]}>
                    {levelLabel(selected.skillLevel)}
                  </Badge>
                </div>
                {selected.dateOfBirth && (
                  <p className="tnum mt-1 text-sm text-fg-2">
                    {formatWallDateFull(selected.dateOfBirth)}{" "}
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

            {selected.school ? (
              <div className="space-y-2 rounded-[12px] border border-line p-4">
                <p className="label">School</p>
                <p className="font-medium">{selected.school}</p>
                <p className="text-sm text-fg-2">
                  School player — no account holder. Added by a coach at the class.
                </p>
              </div>
            ) : (
            <div className="space-y-2 rounded-[12px] border border-line p-4">
              <p className="label">Account holder</p>
              <p className="font-medium">
                {isRealName(selected.clientName)
                  ? selected.clientName
                  : (selected.clientPhone ?? "No name yet")}
              </p>
              {isPhoneOnly(selected.clientEmail) ? (
                <div className="flex items-center gap-2 text-sm text-fg-2">
                  <PhoneGlyph className="h-4 w-4 text-ember" />
                  <span>
                    Signed up by phone
                    {selected.clientPhone && isRealName(selected.clientName)
                      ? ` · ${selected.clientPhone}`
                      : ""}
                  </span>
                </div>
              ) : (
                <>
                  <p className="text-sm text-fg-2">{selected.clientEmail}</p>
                  {selected.clientPhone && (
                    <p className="text-sm text-fg-2">{selected.clientPhone}</p>
                  )}
                </>
              )}
            </div>
            )}

            <Link
              href={`/admin/players/${selected.id}`}
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
