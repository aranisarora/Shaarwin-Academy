"use client";

import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  setAttendance,
  saveSessionNotes,
  reportProblem,
  cantMakeIt,
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
}: {
  sessionId: string;
  startsAt: string;
  roster: RosterRow[];
  coachNotes: string | null;
}) {
  const [rows, setRows] = useState(roster);
  const [notes, setNotes] = useState(coachNotes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attendanceOpen =
    Date.now() >= new Date(startsAt).getTime() - 15 * 60000 &&
    Date.now() <= new Date(startsAt).getTime() + 48 * 3600000;

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
        <p className="label mb-2">Roster</p>
        {rows.length === 0 && (
          <p className="text-sm text-fg-2">No bookings yet.</p>
        )}
        <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
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
              <div className="flex gap-1.5">
                <button
                  aria-label={`Mark ${row.name} attended`}
                  disabled={!attendanceOpen}
                  onClick={() => toggle(row.id, "attended")}
                  className={`flex h-11 w-11 items-center justify-center rounded-[8px] border text-lg disabled:opacity-30 ${
                    row.status === "attended"
                      ? "border-ok bg-ok text-ivory"
                      : "border-line text-fg-2 hover:border-ok"
                  }`}
                >
                  ✓
                </button>
                <button
                  aria-label={`Mark ${row.name} no-show`}
                  disabled={!attendanceOpen}
                  onClick={() => toggle(row.id, "no_show")}
                  className={`flex h-11 w-11 items-center justify-center rounded-[8px] border text-lg disabled:opacity-30 ${
                    row.status === "no_show"
                      ? "border-err bg-err text-ivory"
                      : "border-line text-fg-2 hover:border-err"
                  }`}
                >
                  ✗
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!attendanceOpen && rows.length > 0 && (
          <p className="mt-2 text-xs text-fg-2">
            Attendance opens 15 minutes before the session.
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
