"use client";

import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { nowMs } from "@/lib/academy-time";
import { Input } from "@/components/ui/Input";
import {
  setAttendance,
  saveSessionNotes,
  reportProblem,
  cantMakeIt,
  addSchoolPlayer,
} from "@/app/coach/session/[id]/actions";

type RosterRow = {
  id: string;
  status: string;
  coachNote: string | null;
  name: string;
  level: string;
  junior: boolean;
};

export function SessionRoster({
  sessionId,
  startsAt,
  roster,
  coachNotes,
  isSchool = false,
}: {
  sessionId: string;
  startsAt: string;
  roster: RosterRow[];
  coachNotes: string | null;
  isSchool?: boolean;
}) {
  const [rows, setRows] = useState(roster);
  const [notes, setNotes] = useState(coachNotes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── School classes: register walk-in pupils ──────────────────────────────
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGrade, setNewGrade] = useState("");

  function addPlayer() {
    const name = newName.trim();
    if (name === "") {
      setMessage("Enter the player's name.");
      return;
    }
    const grade = newGrade.trim() === "" ? null : Number(newGrade);
    setMessage(null);
    startTransition(async () => {
      const r = await addSchoolPlayer(sessionId, name, grade);
      if (!r.ok || !r.bookingId) {
        setMessage(r.error ?? "Couldn't add the player.");
        return;
      }
      setRows((prev) => [
        ...prev,
        {
          id: r.bookingId!,
          status: "confirmed",
          coachNote: null,
          name,
          level: "beginner",
          junior: grade !== null && grade + 5 < 18,
        },
      ]);
      setNewName("");
      setNewGrade("");
      setAdding(false);
    });
  }

  const attendanceOpen =
    nowMs() >= new Date(startsAt).getTime() - 15 * 60000 &&
    nowMs() <= new Date(startsAt).getTime() + 48 * 3600000;

  function toggle(bookingId: string, status: "attended" | "no_show") {
    setRows((r) =>
      r.map((row) =>
        row.id === bookingId
          ? { ...row, status: row.status === status ? "confirmed" : status }
          : row
      )
    );
    startTransition(async () => {
      const current = rows.find((r) => r.id === bookingId);
      const next = current?.status === status ? "confirmed" : status;
      const result = await setAttendance(bookingId, next);
      if (!result.ok) setMessage(result.error ?? "Couldn't save attendance.");
    });
  }

  function onNotesChange(value: string) {
    setNotes(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      startTransition(async () => {
        await saveSessionNotes(sessionId, value);
      });
    }, 800);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-lg font-semibold">
          {isSchool ? "Players" : "Mark attendance"}
        </p>
        <p className="mb-3 text-sm text-fg-2">
          {isSchool
            ? "Add each pupil who turns up, then tap them present or absent."
            : "Tap each player as they arrive to record who showed up."}
          {!attendanceOpen && " Attendance opens 15 minutes before the session starts."}
        </p>
        {rows.length === 0 && (
          <p className="text-sm text-fg-2">No bookings yet.</p>
        )}
        <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
          {rows.map((row) => {
            const present = row.status === "attended";
            const absent = row.status === "no_show";
            return (
              <li
                key={row.id}
                className={`px-4 py-3 ${
                  present ? "bg-ok/10" : absent ? "bg-err/10" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {row.name}
                      {row.junior && (
                        <Badge className="ml-2" tone="ember">
                          Junior
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-fg-2">{row.level}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      aria-label={`Mark ${row.name} present`}
                      aria-pressed={present}
                      disabled={!attendanceOpen}
                      onClick={() => toggle(row.id, "attended")}
                      className={`flex h-11 items-center gap-1.5 rounded-[8px] border px-3 text-sm font-semibold disabled:opacity-30 ${
                        present
                          ? "border-ok bg-ok text-ivory"
                          : "border-line text-fg-2 hover:border-ok"
                      }`}
                    >
                      ✓ Present
                    </button>
                    <button
                      aria-label={`Mark ${row.name} no-show`}
                      aria-pressed={absent}
                      disabled={!attendanceOpen}
                      onClick={() => toggle(row.id, "no_show")}
                      className={`flex h-11 items-center gap-1.5 rounded-[8px] border px-3 text-sm font-semibold disabled:opacity-30 ${
                        absent
                          ? "border-err bg-err text-ivory"
                          : "border-line text-fg-2 hover:border-err"
                      }`}
                    >
                      ✗ Absent
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {isSchool && (
          <div className="mt-3">
            {adding ? (
              <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-4">
                <Input
                  label="Player name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <Input
                  label="Grade"
                  type="number"
                  min={1}
                  max={13}
                  hint="Their school grade — used to work out their age."
                  value={newGrade}
                  onChange={(e) => setNewGrade(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button disabled={pending} onClick={addPlayer}>
                    Add player
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setAdding(false);
                      setNewName("");
                      setNewGrade("");
                      setMessage(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setAdding(true)} className="w-full">
                + Add player
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="session-notes" className="label mb-2 block">
          Session notes (autosaves)
        </label>
        <textarea
          id="session-notes"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={4}
          className="w-full rounded-[8px] border border-line bg-surface-2 p-3.5 text-base"
        />
      </div>

      <div className="flex flex-wrap gap-3 border-t border-line pt-5">
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await reportProblem(sessionId);
              setMessage(r.ok ? "Reported — the founder will follow up." : r.error ?? null);
            })
          }
        >
          Report a problem
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Can't make this session? We'll find cover automatically.")) return;
            startTransition(async () => {
              const r = await cantMakeIt(sessionId);
              setMessage(r.ok ? "We're on it — cover is being arranged." : r.error ?? null);
            });
          }}
        >
          Can&apos;t make it
        </Button>
      </div>
      {message && <p className="text-sm text-fg-2">{message}</p>}
    </div>
  );
}
