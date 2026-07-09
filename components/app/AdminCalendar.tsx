"use client";

import { useMemo, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import {
  reassignSession,
  moveSession,
  setSessionCapacity,
  createOneOffSession,
} from "@/app/admin/calendar/actions";
import { getRankedCoaches, cancelSession } from "@/app/admin/actions";

type SessionRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  coachId: string | null;
  coachArrivedAt: string | null;
  title: string;
  capacity: number;
  isPrivate: boolean;
  venueName: string | null;
};

type Coach = { id: string; name: string };
type ClassOption = { id: string; title: string };

function fmt(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function wallDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function wallTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Week view, one lane per coach; UNASSIGNED lane pinned on top whenever a
 * session lacks a coach. Tap-to-reassign (the phone pattern from the plan).
 */
export function AdminCalendar({
  sessions,
  coaches,
  classes,
}: {
  sessions: SessionRow[];
  coaches: Coach[];
  classes: ClassOption[];
}) {
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [target, setTarget] = useState("");
  const [lock, setLock] = useState(false);
  const [ranked, setRanked] = useState<
    { coachId: string; name: string; score: number }[] | null
  >(null);
  const [moveDate, setMoveDate] = useState("");
  const [moveTime, setMoveTime] = useState("");
  const [spots, setSpots] = useState("");
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ classId: "", date: "", time: "18:30", coachId: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lanes = useMemo(() => {
    const unassigned = sessions.filter((s) => !s.coachId);
    const byCoach = coaches.map((coach) => ({
      coach,
      rows: sessions.filter((s) => s.coachId === coach.id),
    }));
    return { unassigned, byCoach };
  }, [sessions, coaches]);

  function openSheet(session: SessionRow) {
    setSelected(session);
    setTarget(session.coachId ?? "");
    setLock(false);
    setMessage(null);
    setRanked(null);
    setMoveDate(wallDate(session.starts_at));
    setMoveTime(wallTime(session.starts_at));
    setSpots(String(session.capacity));
    startTransition(async () => {
      setRanked(await getRankedCoaches(session.id));
    });
  }

  function apply() {
    if (!selected || !target) return;
    startTransition(async () => {
      const r = await reassignSession(selected.id, target, lock);
      setMessage(
        r.ok ? "Coach changed — everyone affected has been told." : (r.error ?? "Failed.")
      );
    });
  }

  const Block = ({ session }: { session: SessionRow }) => (
    <button
      onClick={() => openSheet(session)}
      className={`w-full rounded-[8px] border px-3 py-2 text-left text-sm hover:border-ember ${
        session.coachId ? "border-line bg-surface-2" : "border-err bg-surface-2"
      }`}
    >
      <p className="tnum font-medium">{fmt(session.starts_at)}</p>
      <p className="text-xs text-fg-2">
        {session.title}
        {session.venueName ? ` — ${session.venueName}` : ""}
      </p>
      {session.coachId && session.coachArrivedAt && (
        <span className="mt-1.5 inline-flex">
          <Badge tone="ok">✓ Arrived {wallTime(session.coachArrivedAt)}</Badge>
        </span>
      )}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setAdding(true);
            setAddForm({ classId: classes[0]?.id ?? "", date: "", time: "18:30", coachId: "" });
            setMessage(null);
          }}
        >
          Add a session
        </Button>
      </div>

      {lanes.unassigned.length > 0 && (
        <div className="rounded-[12px] border border-err p-4">
          <p className="label mb-3 !text-err">No coach yet — tap to fix</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lanes.unassigned.map((s) => (
              <Block key={s.id} session={s} />
            ))}
          </div>
        </div>
      )}

      {lanes.byCoach.map(({ coach, rows }) => (
        <div key={coach.id}>
          <p className="label mb-2">{coach.name}</p>
          {rows.length === 0 ? (
            <p className="rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
              Nothing this week.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((s) => (
                <Block key={s.id} session={s} />
              ))}
            </div>
          )}
        </div>
      ))}

      {coaches.length === 0 && (
        <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          No coaches yet — add one from the Coaches tab first.
        </p>
      )}

      {/* ── Session detail ── */}
      <Sheet open={selected !== null} onClose={() => setSelected(null)} title={selected?.title}>
        {selected && (
          <div className="space-y-6">
            <div>
              <p className="tnum font-display text-3xl">{fmt(selected.starts_at)}</p>
              <p className="mt-1 text-fg-2">
                {selected.venueName ?? "Private address"} · {selected.capacity} spots
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.isPrivate && <Badge tone="ember">Private</Badge>}
                {selected.coachId &&
                  (selected.coachArrivedAt ? (
                    <Badge tone="ok">
                      ✓ Coach arrived {wallTime(selected.coachArrivedAt)}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Coach not arrived yet</Badge>
                  ))}
              </div>
            </div>

            <div className="space-y-3 rounded-[12px] border border-line p-4">
              <p className="label">Coach</p>
              {ranked === null ? (
                <div className="flex justify-center py-3">
                  <Spinner />
                </div>
              ) : ranked.length === 0 ? (
                <p className="text-sm text-fg-2">No coach fits this slot automatically.</p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-sm text-fg-2">Best fits first — tap one:</p>
                  {ranked.slice(0, 5).map((r) => (
                    <button
                      key={r.coachId}
                      onClick={() => setTarget(r.coachId)}
                      className={`flex w-full items-center justify-between rounded-[8px] border px-3 py-2 text-sm ${
                        target === r.coachId
                          ? "border-ember bg-surface"
                          : "border-line hover:border-ember"
                      }`}
                    >
                      <span>{r.name}</span>
                      <span className="tnum text-fg-2">{r.score.toFixed(0)}</span>
                    </button>
                  ))}
                </div>
              )}
              <Select
                label="Or pick any coach"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">— pick a coach —</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={lock}
                  onChange={(e) => setLock(e.target.checked)}
                  className="h-5 w-5 accent-[var(--ember)]"
                />
                Keep this coach — don&apos;t swap them automatically
              </label>
              <Button onClick={apply} disabled={pending || !target} className="w-full">
                {pending ? <Spinner /> : "Change coach"}
              </Button>
            </div>

            <div className="space-y-3 rounded-[12px] border border-line p-4">
              <p className="label">Move this session</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="New day"
                  type="date"
                  value={moveDate}
                  onChange={(e) => setMoveDate(e.target.value)}
                />
                <Input
                  label="New time"
                  type="time"
                  value={moveTime}
                  onChange={(e) => setMoveTime(e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                disabled={pending || !moveDate || !moveTime}
                className="w-full"
                onClick={() =>
                  startTransition(async () => {
                    const r = await moveSession(selected.id, moveDate, moveTime);
                    setMessage(
                      r.ok
                        ? "Session moved — everyone booked has been told."
                        : (r.error ?? "Move failed.")
                    );
                  })
                }
              >
                {pending ? <Spinner /> : "Move session"}
              </Button>
            </div>

            {!selected.isPrivate && (
              <div className="space-y-3 rounded-[12px] border border-line p-4">
                <p className="label">Spots (just this session)</p>
                <Input
                  type="number"
                  min={1}
                  value={spots}
                  onChange={(e) => setSpots(e.target.value)}
                  hint="One-off change for this date only — the class keeps its usual number."
                />
                <Button
                  variant="ghost"
                  disabled={pending || !spots}
                  className="w-full"
                  onClick={() =>
                    startTransition(async () => {
                      const r = await setSessionCapacity(selected.id, Number(spots));
                      setMessage(r.ok ? "Spots updated." : (r.error ?? "Failed."));
                    })
                  }
                >
                  {pending ? <Spinner /> : "Update spots"}
                </Button>
              </div>
            )}

            <Button
              variant="destructive"
              disabled={pending}
              className="w-full"
              onClick={() => {
                if (
                  !window.confirm(
                    "Cancel this session? Everyone booked gets a message, and private lessons get their minutes back."
                  )
                )
                  return;
                startTransition(async () => {
                  const r = await cancelSession(selected.id, "cancelled by academy");
                  setMessage(
                    r.ok
                      ? "Cancelled — everyone booked has been told."
                      : (r.error ?? "Cancel failed.")
                  );
                });
              }}
            >
              Cancel session
            </Button>
            {message && <p className="text-sm text-fg-2">{message}</p>}
          </div>
        )}
      </Sheet>

      {/* ── Add one-off session ── */}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a session">
        <div className="space-y-4">
          <p className="text-sm text-fg-2">
            Adds one extra date for an existing class — handy for holidays or make-up sessions.
          </p>
          <Select
            label="Class"
            value={addForm.classId}
            onChange={(e) => setAddForm({ ...addForm, classId: e.target.value })}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Day"
              type="date"
              value={addForm.date}
              onChange={(e) => setAddForm({ ...addForm, date: e.target.value })}
            />
            <Input
              label="Time"
              type="time"
              value={addForm.time}
              onChange={(e) => setAddForm({ ...addForm, time: e.target.value })}
            />
          </div>
          <Select
            label="Coach"
            hint="Leave on automatic and the best-fitting coach is picked for you."
            value={addForm.coachId}
            onChange={(e) => setAddForm({ ...addForm, coachId: e.target.value })}
          >
            <option value="">Automatic — pick the best fit</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button
            disabled={pending || !addForm.classId || !addForm.date || !addForm.time}
            className="w-full"
            onClick={() =>
              startTransition(async () => {
                const r = await createOneOffSession(
                  addForm.classId,
                  addForm.date,
                  addForm.time,
                  addForm.coachId
                );
                if (r.ok) {
                  setMessage("Session added to the calendar.");
                  setAdding(false);
                } else {
                  setMessage(r.error ?? "Couldn't add the session.");
                }
              })
            }
          >
            {pending ? <Spinner /> : "Add session"}
          </Button>
          {message && adding && <p className="text-sm text-err">{message}</p>}
        </div>
      </Sheet>
    </div>
  );
}
