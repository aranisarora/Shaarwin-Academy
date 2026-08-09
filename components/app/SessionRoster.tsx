"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { Input } from "@/components/ui/Input";
import { CheckIcon, LockIcon } from "@/components/ui/icons";
import { AssessmentSheet } from "@/components/app/AssessmentSheet";
import { useNow } from "@/lib/use-now";
import { attendanceClosedReason, attendanceState } from "@/lib/attendance-window";
import {
  setAttendanceBulk,
  saveSessionNotes,
  reportProblem,
  cantMakeIt,
  addSchoolPlayer,
  type AttendanceStatus,
} from "@/app/coach/session/[id]/actions";

type RosterRow = {
  id: string;
  playerId: string;
  status: string;
  coachNote: string | null;
  name: string;
  level: string;
  junior: boolean;
};

const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

export function SessionRoster({
  sessionId,
  startsAt,
  endsAt,
  classTitle,
  roster,
  coachNotes,
  isSchool = false,
  autoWrap = false,
}: {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  classTitle: string | null;
  roster: RosterRow[];
  coachNotes: string | null;
  isSchool?: boolean;
  /** Arrived from a WhatsApp "finish this class" link — go straight to what's left. */
  autoWrap?: boolean;
}) {
  const [rows, setRows] = useState(roster);
  const [notes, setNotes] = useState(coachNotes ?? "");
  const [noteStatus, setNoteStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── School classes: register walk-in pupils ──────────────────────────────
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGrade, setNewGrade] = useState("");

  // ── The assessment sweep ─────────────────────────────────────────────────
  // Which attended player the sheet is pointed at, or null when it is shut.
  //
  // Seeded rather than set from an effect: a coach arriving on `?wrap=1` — the
  // after-class WhatsApp link, which means "finish this class" — with the
  // roster already marked has exactly one thing left to do, so the sheet is
  // open on the first of them from the very first render. Computed from the
  // server's roster, so there is nothing for the client to correct afterwards.
  const [rating, setRating] = useState<{ playerId: string; name: string } | null>(() => {
    if (!autoWrap || roster.length === 0) return null;
    if (roster.some((r) => r.status === "confirmed")) return null; // attendance first
    const first = roster.find((r) => r.status === "attended" && r.playerId);
    return first ? { playerId: first.playerId, name: first.name } : null;
  });
  const [assessed, setAssessed] = useState<Set<string>>(new Set());

  // A ticking clock, not a value frozen at first render: the window used to be
  // read once and never again, so buttons that should have unlocked fifteen
  // minutes before the class stayed dead until someone thought to refresh.
  const now = useNow();
  const state = attendanceState(startsAt, endsAt, now);
  const attendanceOpen = state === "open";
  const closedReason = attendanceClosedReason(state);

  const marked = rows.filter((r) => r.status !== "confirmed");
  const unmarked = rows.filter((r) => r.status === "confirmed");
  const present = rows.filter((r) => r.status === "attended");
  const allMarked = rows.length > 0 && unmarked.length === 0;

  /**
   * Every attendance write, a single tap included, goes through the bulk action
   * as a batch of one. "All present" used to loop `setAttendance` and await each
   * call in turn — twelve children meant twelve sequential round trips behind
   * one tap, each re-checking auth and re-reading the booking, and a failure
   * halfway left the roster half-written with nothing on screen saying which
   * half. One call now, applied optimistically and rolled back as a whole.
   */
  function apply(updates: { bookingId: string; status: AttendanceStatus }[]) {
    if (updates.length === 0) return;
    const before = rows;
    const next = new Map(updates.map((u) => [u.bookingId, u.status]));
    setRows((r) =>
      r.map((row) => (next.has(row.id) ? { ...row, status: next.get(row.id)! } : row))
    );
    setMessage(null);
    startTransition(async () => {
      const result = await setAttendanceBulk(sessionId, updates);
      if (!result.ok) {
        setRows(before);
        setMessage(result.error ?? "Couldn't save attendance.");
      }
    });
  }

  /** Tap a marked button again to clear it — the undo for a mis-tap. */
  function toggle(row: RosterRow, status: "attended" | "no_show") {
    apply([{ bookingId: row.id, status: row.status === status ? "confirmed" : status }]);
  }

  function markAllPresent() {
    apply(unmarked.map((r) => ({ bookingId: r.id, status: "attended" as const })));
  }

  function markRestAbsent() {
    apply(unmarked.map((r) => ({ bookingId: r.id, status: "no_show" as const })));
  }

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
          // The walk-in's player id only arrives with the next revalidate. An
          // empty string keeps the row renderable and makes the assessment
          // sweep skip it this time round rather than open a sheet on nothing.
          playerId: "",
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

  // Who still needs rating, in roster order. Derived rather than held, so
  // marking someone absent mid-sweep drops them out of the queue.
  const toRate = useMemo(
    () => present.filter((r) => r.playerId && !assessed.has(r.playerId)),
    [present, assessed]
  );

  function rateNext() {
    const next = toRate[0];
    if (next) setRating({ playerId: next.playerId, name: next.name });
  }

  return (
    <div className="space-y-6">
      {/* ── Attendance ──────────────────────────────────────────────────── */}
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <p className="text-lg font-semibold">{isSchool ? "Players" : "Who came?"}</p>
          {rows.length > 0 && (
            <p className="tnum shrink-0 text-sm text-fg-2" aria-live="polite">
              {marked.length} of {rows.length} marked
            </p>
          )}
        </div>

        <p className="mb-3 text-sm text-fg-2">
          {isSchool
            ? "Add each pupil who turns up, then tap them present or absent."
            : "Tap each player present or absent. Tap again to undo."}
        </p>

        {closedReason && (
          <p className="mb-3 flex items-start gap-2 rounded-[8px] border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-fg-2">
            <LockIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {closedReason}
          </p>
        )}

        {rows.length === 0 && <p className="text-sm text-fg-2">No bookings yet.</p>}

        {attendanceOpen && unmarked.length >= 2 && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={markAllPresent}
            className="mb-3 w-full"
          >
            <CheckIcon className="h-5 w-5" />
            {marked.length === 0 ? "Everyone came" : `Mark the other ${unmarked.length} present`}
          </Button>
        )}

        <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
          {rows.map((row) => {
            const isPresent = row.status === "attended";
            const isAbsent = row.status === "no_show";
            return (
              <li
                key={row.id}
                className={`px-4 py-3 ${isPresent ? "bg-ok/10" : isAbsent ? "bg-err/10" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {row.name}
                      {row.junior && (
                        <Badge className="ml-2" tone="ember">
                          Junior
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-fg-2">
                      {row.level}
                      {assessed.has(row.playerId) && " · rated"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      aria-label={`Mark ${row.name} present`}
                      aria-pressed={isPresent}
                      disabled={!attendanceOpen}
                      onClick={() => toggle(row, "attended")}
                      className={`flex h-11 items-center gap-1.5 rounded-[8px] border px-3 text-sm font-semibold disabled:opacity-30 ${
                        isPresent
                          ? "border-ok bg-ok text-ivory"
                          : "border-line text-fg-2 hover:border-ok"
                      }`}
                    >
                      ✓ Present
                    </button>
                    <button
                      aria-label={`Mark ${row.name} absent`}
                      aria-pressed={isAbsent}
                      disabled={!attendanceOpen}
                      onClick={() => toggle(row, "no_show")}
                      className={`flex h-11 items-center gap-1.5 rounded-[8px] border px-3 text-sm font-semibold disabled:opacity-30 ${
                        isAbsent
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

        {/* The tail of a half-finished roster: the coach has ticked off the
            handful who came and the rest simply did not. One tap closes it. */}
        {attendanceOpen && marked.length > 0 && unmarked.length > 0 && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={markRestAbsent}
            className="mt-3 w-full"
          >
            Mark the other {unmarked.length} absent
          </Button>
        )}

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

      {/* ── Step two, in the same place ──────────────────────────────────── */}
      {present.length > 0 && (
        <div className="rounded-[12px] border border-ember/40 bg-surface-2 p-4">
          {toRate.length > 0 ? (
            <>
              <p className="font-medium">
                {allMarked ? "Attendance done." : "Nearly there."} Rate {toRate.length}{" "}
                {toRate.length === 1 ? "player" : "players"}?
              </p>
              <p className="mt-1 text-sm text-fg-2">
                Half a minute each, and it never leaves this screen. Next up:{" "}
                {firstName(toRate[0].name)}.
              </p>
              <Button className="mt-3 w-full" onClick={rateNext}>
                Rate {firstName(toRate[0].name)}
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-ok">
              <CheckIcon className="h-5 w-5 shrink-0" />
              <p className="font-medium">
                Class wrapped — attendance and assessments are all in. Thank you!
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Notes ───────────────────────────────────────────────────────── */}
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
        <div className="flex flex-wrap gap-3">
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
          <ConfirmAction
            fullWidth={false}
            label="Can't make it"
            prompt="Can't make it? We'll find cover automatically."
            confirmLabel="Yes, find cover"
            keepLabel="Back"
            pending={pending}
            onConfirm={() =>
              startTransition(async () => {
                const r = await cantMakeIt(sessionId);
                setMessage(r.ok ? "We're on it — cover is being arranged." : r.error ?? null);
              })
            }
          />
        </div>
      </div>

      {message && <p className="text-sm text-err">{message}</p>}

      {rating && (
        <AssessmentSheet
          // A fresh sheet per player, so walking the roster doesn't have to
          // reset one instance's state by hand between children.
          key={rating.playerId}
          open
          onClose={() => setRating(null)}
          playerId={rating.playerId}
          playerName={rating.name}
          sessionId={sessionId}
          classTitle={classTitle}
          onSaved={() => {
            const done = new Set(assessed).add(rating.playerId);
            setAssessed(done);
            // Straight on to the next child rather than back to the list and in
            // again — the sweep is the whole point.
            const next = present.find((r) => r.playerId && !done.has(r.playerId));
            setRating(next ? { playerId: next.playerId, name: next.name } : null);
          }}
        />
      )}
    </div>
  );
}
