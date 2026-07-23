"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { savePlayers } from "@/app/app/onboarding/actions";

type Mode = "me" | "kids" | "both";

const MODES: [Mode, string][] = [
  ["me", "Just me"],
  ["kids", "My kids"],
  ["both", "Me and my kids"],
];

export type ExistingPlayer = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
};

type Row = {
  id?: string;
  fullName: string;
  /** 4-digit year; stored as Jan 1 of that year in players.date_of_birth. */
  yearOfBirth: string;
};

const blankRow = (): Row => ({ fullName: "", yearOfBirth: "" });

function toRow(p: ExistingPlayer): Row {
  return {
    id: p.id,
    fullName: p.full_name,
    yearOfBirth: p.date_of_birth ? p.date_of_birth.slice(0, 4) : "",
  };
}

/** Year → ISO date for the players.date_of_birth column; "" when unusable. */
function yearToDate(year: string): string {
  const y = Number(year.trim());
  const now = new Date().getFullYear();
  return Number.isInteger(y) && y >= now - 100 && y <= now ? `${y}-01-01` : "";
}

/**
 * "Who's playing?" splits into just me / my kids / both; the self row is the
 * player auto-created at signup, so a single adult finishes in two taps.
 * Existing accounts arrive with their roster prefilled.
 */
export function PlayersStep({
  profileName,
  existing,
  onDone,
}: {
  profileName: string;
  existing: ExistingPlayer[];
  onDone: () => void;
}) {
  // The auto-created self-player shares the profile's name; fall back to
  // "not found" for older accounts that renamed it.
  const selfIndex = existing.findIndex((p) => p.full_name === profileName);
  const selfExisting = selfIndex >= 0 ? existing[selfIndex] : null;
  const existingOthers = existing.filter((_, i) => i !== selfIndex).map(toRow);

  // Existing rosters pick their own starting answer; new accounts choose.
  const [mode, setMode] = useState<Mode | null>(
    existingOthers.length === 0 ? null : selfExisting ? "both" : "kids"
  );
  const [self, setSelf] = useState<Row>(
    selfExisting ? toRow(selfExisting) : { fullName: profileName, yearOfBirth: "" }
  );
  const [others, setOthers] = useState<Row[]>(existingOthers);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selfPlays = mode === "me" || mode === "both";
  const roster = [...(selfPlays ? [self] : []), ...others];
  const canFinish = mode !== null && roster.some((r) => r.fullName.trim());

  function choose(next: Mode) {
    setMode(next);
    // A kids answer needs somewhere to write the first name.
    if (next !== "me" && others.length === 0) setOthers([blankRow()]);
  }

  function updateOther(index: number, patch: Partial<Row>) {
    setOthers(others.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function finish() {
    startTransition(async () => {
      const r = await savePlayers({
        players: roster.map(({ yearOfBirth, ...p }) => ({
          ...p,
          dateOfBirth: yearToDate(yearOfBirth),
        })),
        // "My kids" retires the player row auto-created for the account
        // holder at signup; blank kid rows are filtered out server-side.
        removeIds: !selfPlays && self.id ? [self.id] : [],
      });
      if (!r.ok) return setError(r.error ?? "Something went wrong. Try again.");
      onDone();
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-2" role="radiogroup" aria-label="Who's playing?">
        {MODES.map(([value, labelText]) => (
          <button
            key={value}
            role="radio"
            aria-checked={mode === value}
            onClick={() => choose(value)}
            className={`min-h-13 rounded-[12px] border px-5 text-left text-base font-semibold transition-colors ${
              mode === value
                ? "border-ember bg-surface-2 text-fg"
                : "border-line text-fg-2 hover:border-ember hover:text-fg"
            }`}
          >
            {labelText}
          </button>
        ))}
      </div>

      {selfPlays && (
        <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-4">
          <p className="label">You</p>
          <Input
            label="Name"
            autoComplete="name"
            value={self.fullName}
            onChange={(e) => setSelf({ ...self, fullName: e.target.value })}
          />
          <Input
            label="Year of birth (optional)"
            type="number"
            inputMode="numeric"
            placeholder="e.g. 1990"
            value={self.yearOfBirth}
            onChange={(e) => setSelf({ ...self, yearOfBirth: e.target.value })}
          />
        </div>
      )}

      {mode !== null &&
        others.map((row, i) => (
          <div
            key={row.id ?? `new-${i}`}
            className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-4"
          >
            <div className="flex items-center justify-between">
              <p className="label">{row.fullName.trim() || "Player"}</p>
              {!row.id && others.length > (mode === "kids" ? 1 : 0) && (
                <button
                  onClick={() => setOthers(others.filter((_, j) => j !== i))}
                  className="text-xs text-fg-2 hover:text-err"
                >
                  Remove
                </button>
              )}
            </div>
            <Input
              label="Name"
              value={row.fullName}
              onChange={(e) => updateOther(i, { fullName: e.target.value })}
            />
            <Input
              label="Year of birth"
              hint="Helps us place them in the right group."
              type="number"
              inputMode="numeric"
              placeholder="e.g. 2014"
              value={row.yearOfBirth}
              onChange={(e) => updateOther(i, { yearOfBirth: e.target.value })}
            />
          </div>
        ))}

      {mode !== null && (
        <>
          <Button
            variant="ghost"
            onClick={() => setOthers([...others, blankRow()])}
            className="w-full"
          >
            Add another player
          </Button>

          <Button disabled={pending || !canFinish} onClick={finish} className="w-full" size="lg">
            {pending ? <Spinner /> : "That's everyone"}
          </Button>
        </>
      )}
      {error && <p className="text-sm text-err">{error}</p>}
    </div>
  );
}
