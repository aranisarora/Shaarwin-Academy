"use client";

import Link from "next/link";
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
  const [noteStatus, setNoteStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [message, setMessage] = useState<string | null>(null);
  // "Can't make it" confirms in two taps (native confirm looks broken in a PWA).
  const [cantArmed, setCantArmed] = useState(false);
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

  // The common case: everyone showed up. Flip every still-"confirmed" row to
  // attended optimistically, then persist each via the existing per-row action
  // (one revalidate lands at the end). Individual toggles still undo anyone.
  const confirmedCount = rows.filter((r) => r.status === "confirmed").length;
  function markAllPresent() {
    const ids = rows.filter((r) => r.status === "confirmed").map((r) => r.id);
    setRows((r) =>
      r.map((row) => (row.status === "confirmed" ? { ...row, status: "attended" } : row))
    );
    startTransition(async () => {
      for (const id of ids) {
        const result = await setAttendance(id, "attended");
        if (!result.ok) {
          setMessage(result.error ?? "Couldn't save attendance.");
          break;
        }
      }
    });
  }

  const anyPresent = rows.some((r) => r.status === "attended");

  function onNotesChange(value: string) {
    setNotes(value);
    setNoteStatus("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setNoteStatus("saving");
      startTransition(async () => {
        await saveSessionNotes(sessionId, value);
        setNoteStatus("saved");
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
        {attendanceOpen && confirmedCount >= 2 && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={markAllPresent}
            className="mb-3 w-full"
          >
            ✓ All present
          </Button>
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

        {anyPresent && (
          <p className="mt-3 text-sm text-fg-2">
            Add a quick skills note for today?{" "}
            <Link href="/coach/players" className="text-ember hover:underline">
              Assessments →
            </Link>
          </p>
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
        {noteStatus !== "idle" && (
          <p className="mt-1 text-xs text-fg-2">
            {noteStatus === "saving" ? "Saving…" : "Saved ✓"}
          </p>
        )}
      </div>

      <div className="border-t border-line pt-5">
        {cantArmed ? (
          <div className="space-y-2 rounded-[8px] border border-line p-3">
            <p className="text-sm text-fg-2">
              Can&apos;t make it? We&apos;ll find cover automatically.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => setCantArmed(false)}>
                Back
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await cantMakeIt(sessionId);
                    setCantArmed(false);
                    setMessage(
                      r.ok ? "We're on it — cover is being arranged." : r.error ?? null
                    );
                  })
                }
              >
                Yes, find cover
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await reportProblem(sessionId);
                  setMessage(
                    r.ok ? "Reported — the founder will follow up." : r.error ?? null
                  );
                })
              }
            >
              Report a problem
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => setCantArmed(true)}
            >
              Can&apos;t make it
            </Button>
          </div>
        )}
      </div>
      {message && <p className="text-sm text-fg-2">{message}</p>}
    </div>
  );
}
