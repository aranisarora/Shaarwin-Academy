"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { completeOnboarding } from "@/app/app/onboarding/actions";

const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "elite"];

type ExistingPlayer = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  skill_level: string;
};

type Row = {
  id?: string;
  fullName: string;
  dateOfBirth: string;
  skillLevel: string;
};

function toRow(p: ExistingPlayer): Row {
  return {
    id: p.id,
    fullName: p.full_name,
    dateOfBirth: p.date_of_birth ?? "",
    skillLevel: p.skill_level,
  };
}

/**
 * Household setup. The first player defaults to the account holder (the row
 * auto-created at signup); toggling "just managing" removes that row and asks
 * for at least one other player instead. Existing accounts arriving here see
 * their current roster prefilled.
 */
export function OnboardingFlow({
  profileName,
  existing,
}: {
  profileName: string;
  existing: ExistingPlayer[];
}) {
  const router = useRouter();

  // The auto-created self-player shares the profile's name; fall back to the
  // first player so older accounts that renamed it still get a sensible split.
  const selfIndex = existing.findIndex((p) => p.full_name === profileName);
  const selfExisting = selfIndex >= 0 ? existing[selfIndex] : null;

  const [selfIsPlayer, setSelfIsPlayer] = useState(true);
  const [self, setSelf] = useState<Row>(
    selfExisting
      ? toRow(selfExisting)
      : { fullName: profileName, dateOfBirth: "", skillLevel: "beginner" }
  );
  const [others, setOthers] = useState<Row[]>(
    existing.filter((_, i) => i !== selfIndex).map(toRow)
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const roster = [...(selfIsPlayer ? [self] : []), ...others];
  const canFinish = roster.some((r) => r.fullName.trim());

  function updateOther(index: number, patch: Partial<Row>) {
    setOthers(others.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function finish() {
    startTransition(async () => {
      const r = await completeOnboarding({
        players: roster,
        // Dropping the self row only removes it when it already exists in the
        // DB; blank added rows are just filtered out server-side.
        removeIds:
          !selfIsPlayer && self.id ? [self.id] : [],
      });
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      router.push("/app");
      router.refresh();
    });
  }

  const fields = (row: Row, onChange: (patch: Partial<Row>) => void, nameLocked = false) => (
    <div className="space-y-2">
      <Input
        label="Name"
        value={row.fullName}
        disabled={nameLocked}
        onChange={(e) => onChange({ fullName: e.target.value })}
      />
      <Input
        label="Date of birth"
        type="date"
        value={row.dateOfBirth}
        onChange={(e) => onChange({ dateOfBirth: e.target.value })}
      />
      <Select
        label="Skill level"
        value={row.skillLevel}
        onChange={(e) => onChange({ skillLevel: e.target.value })}
      >
        {SKILL_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-2" role="radiogroup" aria-label="Are you playing?">
        {(
          [
            [true, "I'm playing"],
            [false, "I'm just managing players"],
          ] as const
        ).map(([value, labelText]) => (
          <button
            key={labelText}
            role="radio"
            aria-checked={selfIsPlayer === value}
            onClick={() => setSelfIsPlayer(value)}
            className={`flex-1 rounded-[12px] border px-4 py-3 text-sm transition-colors ${
              selfIsPlayer === value
                ? "border-ember bg-surface-2 text-fg"
                : "border-line text-fg-2 hover:text-fg"
            }`}
          >
            {labelText}
          </button>
        ))}
      </div>

      {selfIsPlayer && (
        <div className="rounded-[12px] border border-line bg-surface-2 p-4">
          <p className="label mb-3">You</p>
          {fields(self, (patch) => setSelf({ ...self, ...patch }))}
        </div>
      )}

      {others.map((row, i) => (
        <div key={row.id ?? `new-${i}`} className="rounded-[12px] border border-line p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="label">Player {selfIsPlayer ? i + 2 : i + 1}</p>
            {!row.id && (
              <button
                onClick={() => setOthers(others.filter((_, j) => j !== i))}
                className="text-xs text-fg-2 hover:text-err"
              >
                Remove
              </button>
            )}
          </div>
          {fields(row, (patch) => updateOther(i, patch))}
        </div>
      ))}

      <Button
        variant="ghost"
        onClick={() =>
          setOthers([...others, { fullName: "", dateOfBirth: "", skillLevel: "beginner" }])
        }
        className="w-full"
      >
        Add another player
      </Button>

      {!selfIsPlayer && !canFinish && (
        <p className="text-sm text-fg-2">Add at least one player to continue.</p>
      )}

      <Button disabled={pending || !canFinish} onClick={finish} className="w-full">
        {pending ? <Spinner /> : "Finish setup"}
      </Button>
      {error && <p className="text-sm text-err">{error}</p>}
    </div>
  );
}
