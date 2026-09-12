"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { FilterBar, type FilterDef } from "@/components/ui/FilterBar";
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
  /** The venue id behind `school`. Filtering keys on this, never on the name:
   *  the name is a label with a fallback, and two labels that read the same are
   *  still two different schools. Null on a household player. */
  schoolVenueId?: string | null;
  /** School grade, where a coach recorded one. Null on a household player and
   *  on the older pupils nobody asked. */
  grade?: number | null;
  /** The household's plan, rolled up on the server. Null on a school pupil —
   *  the school pays for them, so they are outside billing altogether. */
  planName?: string | null;
  subStatus?: string | null;
  /** Every plan the household holds, not just the one the sheet shows. A
   *  household can be on two live plans at once, and a filter promising
   *  "everyone on this plan" has to find them under both. Empty on a school
   *  pupil, and on a household paying for nothing. */
  planNames: string[];
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

/** Where a level sits on the ladder, so the filter reads beginner → elite
 *  however the rows happen to be ordered. Anything unrecognised sorts last. */
function levelRank(level: string): number {
  const i = (LEVELS as readonly string[]).indexOf(level);
  return i === -1 ? LEVELS.length : i;
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

/** The household's plan as it reads inside the sheet — the billing state only
 *  gets a mention when it's something the founder would want to chase. */
function planLine(row: PlayerRow): string {
  if (!row.planName) return "No plan";
  if (row.subStatus === "past_due") return `${row.planName} · past due`;
  if (row.subStatus === "trialing") return `${row.planName} · trial`;
  return row.planName;
}

function clientSubline(row: PlayerRow): string {
  // School players have no account holder — show the school they attend. The
  // school's name already says they're a school pupil, so when a coach took
  // their grade down that's the more useful second half of the line.
  if (row.school) {
    return row.grade != null
      ? `${row.school} · Grade ${row.grade}`
      : `${row.school} · school player`;
  }
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
  const [selected, setSelected] = useState<PlayerRow | null>(null);

  // Three ways to narrow the list — level, school and the household's plan.
  // All of it is local state, like every other filtered list here: the tab is
  // one screen of already-loaded rows, so a URL round-trip would buy nothing.
  const [levelFilter, setLevelFilter] = useState("all");
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");

  // Every option comes from the players actually on the list, so we never offer
  // a bucket that turns up empty. Schools are keyed by venue id and only
  // labelled with the name.
  const levelOptions = useMemo(
    () => [...new Set(players.map((p) => p.skillLevel))].sort((a, b) => levelRank(a) - levelRank(b)),
    [players]
  );
  const schoolOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of players) {
      if (p.schoolVenueId) byId.set(p.schoolVenueId, p.school ?? "School");
    }
    return [...byId]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [players]);
  const planOptions = useMemo(
    () => [...new Set(players.flatMap((p) => p.planNames))].sort((a, b) => a.localeCompare(b)),
    [players]
  );
  // "Household players" is the absence of a school, not the absence of a venue
  // id: a pupil whose venue link is broken is still somebody's school pupil and
  // belongs nowhere near that bucket.
  const hasHousehold = useMemo(() => players.some((p) => !p.school), [players]);
  // Deleting a venue leaves its pupils behind with nothing pointing at a school
  // — no venue id, and no account holder either, since they never had one. They
  // would sit in the list matching no school and no household, findable only by
  // scrolling past everyone. This bucket is where they turn up.
  const hasUnlinkedSchool = useMemo(
    () => players.some((p) => p.school && !p.schoolVenueId),
    [players]
  );
  const hasUnplanned = useMemo(
    () => players.some((p) => p.clientId !== null && p.planNames.length === 0),
    [players]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter((p) => {
      if (levelFilter !== "all" && p.skillLevel !== levelFilter) return false;
      if (schoolFilter === "household") {
        if (p.school) return false;
      } else if (schoolFilter === "unlinked") {
        if (!p.school || p.schoolVenueId) return false;
      } else if (schoolFilter !== "all" && p.schoolVenueId !== schoolFilter) {
        return false;
      }
      // "No plan" means a household that isn't paying for anything. A school
      // pupil has no plan either, but that's the arrangement rather than a gap,
      // so they stay out of this bucket — the school filter is where you find
      // them.
      if (planFilter === "none") {
        if (p.clientId === null || p.planNames.length > 0) return false;
      } else if (planFilter !== "all" && !p.planNames.includes(planFilter)) {
        return false;
      }
      if (q === "") return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        p.clientEmail.toLowerCase().includes(q) ||
        (p.clientPhone ?? "").toLowerCase().includes(q) ||
        (p.school ?? "").toLowerCase().includes(q)
      );
    });
  }, [players, search, levelFilter, schoolFilter, planFilter]);

  const filterDefs: FilterDef[] = [
    {
      key: "level",
      aria: "Filter by level",
      label: "All levels",
      value: levelFilter,
      defaultValue: "all",
      onChange: setLevelFilter,
      options: [
        { value: "all", label: "All levels" },
        ...levelOptions.map((l) => ({ value: l, label: levelLabel(l) })),
      ],
    },
    ...(schoolOptions.length > 0 || hasUnlinkedSchool
      ? [
          {
            key: "school",
            aria: "Filter by school",
            label: "All schools",
            value: schoolFilter,
            defaultValue: "all",
            onChange: setSchoolFilter,
            options: [
              { value: "all", label: "All schools" },
              ...schoolOptions,
              ...(hasUnlinkedSchool
                ? [{ value: "unlinked", label: "Unlinked school" }]
                : []),
              ...(hasHousehold
                ? [{ value: "household", label: "Household players" }]
                : []),
            ],
          },
        ]
      : []),
    ...(planOptions.length > 0
      ? [
          {
            key: "plan",
            aria: "Filter by plan",
            label: "All plans",
            value: planFilter,
            defaultValue: "all",
            onChange: setPlanFilter,
            options: [
              { value: "all", label: "All plans" },
              ...planOptions.map((n) => ({ value: n, label: n })),
              ...(hasUnplanned ? [{ value: "none", label: "No plan" }] : []),
            ],
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-fg-2">
          Everyone we coach — household players and school pupils.
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

      {players.length > 0 && <FilterBar filters={filterDefs} />}

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
                {selected.grade != null && (
                  <p className="tnum text-sm text-fg-2">Grade {selected.grade}</p>
                )}
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
              <p className="text-sm text-fg-2">{planLine(selected)}</p>
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
