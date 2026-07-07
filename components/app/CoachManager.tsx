"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { InfoTip } from "@/components/ui/InfoTip";
import { promoteToCoach, saveCoach, setCoachActive } from "@/app/admin/coaches/actions";

export type CoachRow = {
  id: string;
  name: string;
  email: string;
  bio: string;
  travelRadiusKm: number;
  maxTeachableLevel: string;
  tier: number;
  dbsChecked: boolean;
  active: boolean;
};

type Candidate = { id: string; name: string; email: string };

const LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const;

export function CoachManager({
  coaches,
  candidates,
}: {
  coaches: CoachRow[];
  candidates: Candidate[];
}) {
  const [editing, setEditing] = useState<CoachRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = candidates.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  );

  function save() {
    if (!editing) return;
    startTransition(async () => {
      const r = await saveCoach({
        id: editing.id,
        bio: editing.bio,
        travelRadiusKm: Number(editing.travelRadiusKm),
        maxTeachableLevel: editing.maxTeachableLevel,
        tier: Number(editing.tier),
        dbsChecked: editing.dbsChecked,
      });
      if (r.ok) {
        setMessage("Coach saved.");
        setEditing(null);
      } else {
        setSheetMessage(r.error ?? "Save failed.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="label">Coaches</p>
        <Button
          onClick={() => {
            setAdding(true);
            setSearch("");
            setSheetMessage(null);
          }}
        >
          Add a coach
        </Button>
      </div>
      {message && <p className="text-sm text-fg-2">{message}</p>}

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {coaches.map((c) => (
          <li key={c.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  setEditing({ ...c });
                  setSheetMessage(null);
                }}
                className="text-left hover:text-ember"
              >
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-fg-2">
                  {c.email} · travels up to {c.travelRadiusKm} km
                </p>
              </button>
              <div className="flex flex-col items-end gap-1.5">
                <Badge tone={c.active ? "ok" : "err"}>{c.active ? "working" : "paused"}</Badge>
                <Badge tone={c.dbsChecked ? "ok" : "err"}>
                  {c.dbsChecked ? "Background check ✓" : "No background check"}
                </Badge>
              </div>
            </div>
          </li>
        ))}
        {coaches.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-fg-2">
            No coaches yet — tap “Add a coach” to get started.
          </li>
        )}
      </ul>

      {/* ── Edit coach ── */}
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing?.name}>
        {editing && (
          <div className="space-y-4">
            <p className="text-sm text-fg-2">{editing.email}</p>
            <Input
              label="Short bio"
              value={editing.bio}
              onChange={(e) => setEditing({ ...editing, bio: e.target.value })}
              placeholder="A line or two shown to clients"
            />
            <Input
              label="Travels up to (km)"
              type="number"
              min={1}
              hint="How far they'll go for home sessions."
              value={editing.travelRadiusKm}
              onChange={(e) =>
                setEditing({ ...editing, travelRadiusKm: Number(e.target.value) })
              }
            />
            <Select
              label="Can teach up to"
              hint="They won't be given classes above this level."
              value={editing.maxTeachableLevel}
              onChange={(e) => setEditing({ ...editing, maxTeachableLevel: e.target.value })}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
            <Select
              label="Seniority"
              hint="When two coaches fit equally, the more senior one is picked."
              value={editing.tier}
              onChange={(e) => setEditing({ ...editing, tier: Number(e.target.value) })}
            >
              <option value={1}>Junior</option>
              <option value={2}>Senior</option>
              <option value={3}>Head coach</option>
            </Select>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={editing.dbsChecked}
                onChange={(e) => setEditing({ ...editing, dbsChecked: e.target.checked })}
                className="h-5 w-5 accent-[var(--ember)]"
              />
              Background check verified
              <InfoTip text="Needed before they can coach anyone under 18. Tick this once you've seen their certificate." />
            </label>

            <Button onClick={save} disabled={pending} className="w-full">
              {pending ? <Spinner /> : "Save coach"}
            </Button>
            <Button
              variant={editing.active ? "destructive" : "ghost"}
              disabled={pending}
              className="w-full"
              onClick={() => {
                const msg = editing.active
                  ? "Pause this coach? They stop getting new sessions. Sessions already on their calendar stay until you reassign them."
                  : "Put this coach back to work?";
                if (!window.confirm(msg)) return;
                startTransition(async () => {
                  const r = await setCoachActive(editing.id, !editing.active);
                  if (r.ok) {
                    setMessage(editing.active ? "Coach paused." : "Coach is back.");
                    setEditing(null);
                  } else {
                    setSheetMessage(r.error ?? "Failed.");
                  }
                });
              }}
            >
              {editing.active ? "Pause coach" : "Unpause coach"}
            </Button>
            {sheetMessage && <p className="text-sm text-err">{sheetMessage}</p>}
          </div>
        )}
      </Sheet>

      {/* ── Add coach (promote an existing account) ── */}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a coach">
        <div className="space-y-4">
          <p className="text-sm text-fg-2">
            Coaches use a normal account. First, ask them to sign up on the website like any
            client. Then find their name below and make them a coach.
          </p>
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-[12px] border border-line">
            {matches.slice(0, 20).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-fg-2">{c.email}</p>
                </div>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Make ${c.name} a coach?`)) return;
                    startTransition(async () => {
                      const r = await promoteToCoach(c.id);
                      if (r.ok) {
                        setMessage(`${c.name} is now a coach — tap their name to set details.`);
                        setAdding(false);
                      } else {
                        setSheetMessage(r.error ?? "Failed.");
                      }
                    });
                  }}
                >
                  Make coach
                </Button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-fg-2">
                No account found. Ask them to sign up on the website first — they&apos;ll
                appear here right after.
              </li>
            )}
          </ul>
          {sheetMessage && <p className="text-sm text-err">{sheetMessage}</p>}
        </div>
      </Sheet>
    </div>
  );
}
