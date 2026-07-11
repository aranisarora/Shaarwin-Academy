"use client";

// Session detail sheet for the merged admin calendar. One edit form covers
// everything; on save a Google Calendar-style scope step asks whether the
// change is for "just this session" or "every week" (the whole class).

import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import {
  endGroupClass,
  moveSession,
  reassignSession,
  setSessionCapacity,
  updateGroupClass,
} from "@/app/admin/calendar/actions";
import { cancelSession, getRankedCoaches } from "@/app/admin/actions";
import { AddressDisplay } from "@/components/app/AddressDisplay";
import { ClassDetailFields, generateClassTitle, type ClassFormState } from "./ClassFields";
import {
  clockTime,
  fmtWhen,
  wallDate,
  wallTime,
  weekdayOfDate,
  type Coach,
  type SessionRow,
  type Venue,
} from "./admin-calendar-types";

type Scope = "session" | "class";

export function AdminSessionSheet({
  session,
  coaches,
  venues,
  onClose,
}: {
  session: SessionRow;
  coaches: Coach[];
  venues: Venue[];
  onClose: () => void;
}) {
  // Mounted fresh per session (parent keys on session.id), so initializers
  // read the session directly — no prop-sync effects.
  const [form, setForm] = useState<ClassFormState>({
    title: generateClassTitle(session.classLevel, session.classWeekday, wallTime(session.starts_at)),
    description: session.classDescription,
    skillLevel: session.classLevel,
    capacity: session.capacity,
    durationMinutes: session.classDuration,
    venueId: session.classVenueId ?? "",
    weekday: session.classWeekday,
    time: wallTime(session.starts_at),
    coachId: "",
  });

  function updateForm(next: ClassFormState) {
    setForm({ ...next, title: generateClassTitle(next.skillLevel, next.weekday, next.time) });
  }
  const [date, setDate] = useState(wallDate(session.starts_at));
  const [step, setStep] = useState<"edit" | "scope">("edit");
  const [scope, setScope] = useState<Scope>("session");
  const [target, setTarget] = useState(session.coachId ?? "");
  const [lock, setLock] = useState(false);
  const [ranked, setRanked] = useState<
    { coachId: string; name: string; score: number }[] | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getRankedCoaches(session.id).then((r) => {
      if (alive) setRanked(r);
    });
    return () => {
      alive = false;
    };
  }, [session.id]);

  // What changed vs the session as it stands — drives the scope step.
  const dateChanged = date !== wallDate(session.starts_at);
  const timeChanged = form.time !== wallTime(session.starts_at);
  const slotChanged = dateChanged || timeChanged;
  const spotsChanged = form.capacity !== session.capacity;
  const classChanged =
    form.description !== session.classDescription ||
    form.skillLevel !== session.classLevel ||
    form.durationMinutes !== session.classDuration ||
    form.venueId !== (session.classVenueId ?? "");
  const anyChanged = slotChanged || spotsChanged || classChanged;

  function applyCoach() {
    if (!session || !target) return;
    startTransition(async () => {
      let r = await reassignSession(session.id, target, lock);
      if (!r.ok && r.code === "filter_failed") {
        // The rules say no — but the founder can override. A hard time clash
        // is still blocked by the database either way.
        const goAhead = window.confirm(
          `${r.error ?? "That coach doesn't fit the rules."}\n\nAssign them anyway?`
        );
        if (!goAhead) {
          setMessage(r.error ?? "Failed.");
          return;
        }
        r = await reassignSession(session.id, target, lock, true);
      }
      setMessage(
        r.ok ? "Coach changed — everyone affected has been told." : (r.error ?? "Failed.")
      );
    });
  }

  function apply(chosen: Scope) {
    if (!session) return;
    startTransition(async () => {
      if (chosen === "session") {
        if (slotChanged) {
          const r = await moveSession(session.id, date, form.time);
          if (!r.ok) {
            setMessage(r.error ?? "Move failed.");
            setStep("edit");
            return;
          }
        }
        if (spotsChanged) {
          const r = await setSessionCapacity(session.id, form.capacity);
          if (!r.ok) {
            setMessage(r.error ?? "Couldn't update the spots.");
            setStep("edit");
            return;
          }
        }
        setMessage("Saved — just this session changed. Everyone booked has been told.");
      } else {
        // Only fields the founder deliberately edited feed the class update —
        // this session may be a one-off on a different day, or carry a spots
        // override, and those must not silently re-slot the whole class.
        const r = await updateGroupClass({
          classId: session.classId,
          title: form.title,
          description: form.description,
          skillLevel: form.skillLevel,
          capacity: spotsChanged ? form.capacity : session.classCapacity,
          durationMinutes: form.durationMinutes,
          venueId: form.venueId,
          weekday: dateChanged ? weekdayOfDate(date) : session.classWeekday,
          time: timeChanged ? form.time : session.classTime,
        });
        setMessage(
          r.ok
            ? "Saved for every week — upcoming sessions moved and everyone booked was told."
            : (r.error ?? "Couldn't save the class.")
        );
      }
      setStep("edit");
    });
  }

  return (
    <Sheet open onClose={onClose} title={session.title}>
      {step === "scope" ? (
        /* ── Google Calendar-style scope chooser ── */
        <div className="space-y-4">
          <p className="font-medium">Apply these changes to…</p>
          <div className="space-y-2">
            <label
              className={`flex items-start gap-3 rounded-[8px] border p-3 ${
                classChanged
                  ? "cursor-not-allowed border-line opacity-50"
                  : scope === "session"
                    ? "cursor-pointer border-ember"
                    : "cursor-pointer border-line hover:border-ember"
              }`}
            >
              <input
                type="radio"
                name="scope"
                className="mt-1 h-4 w-4 accent-[var(--ember)]"
                checked={scope === "session"}
                disabled={classChanged}
                onChange={() => setScope("session")}
              />
              <span>
                <span className="block font-medium">Just this session</span>
                <span className="block text-sm text-fg-2">
                  Only {fmtWhen(session.starts_at)} changes. Other weeks stay as they are.
                </span>
              </span>
            </label>
            <label
              className={`flex items-start gap-3 rounded-[8px] border p-3 ${
                scope === "class"
                  ? "cursor-pointer border-ember"
                  : "cursor-pointer border-line hover:border-ember"
              }`}
            >
              <input
                type="radio"
                name="scope"
                className="mt-1 h-4 w-4 accent-[var(--ember)]"
                checked={scope === "class"}
                onChange={() => setScope("class")}
              />
              <span>
                <span className="block font-medium">Every week — the whole class</span>
                <span className="block text-sm text-fg-2">
                  All upcoming sessions of {session.title} change. Everyone booked gets a
                  message automatically.
                </span>
              </span>
            </label>
          </div>
          {classChanged && (
            <p className="text-sm text-fg-2">
              You changed the name, description, level, venue or length — those always apply
              to the whole class.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setStep("edit")} disabled={pending}>
              Back
            </Button>
            <Button onClick={() => apply(scope)} disabled={pending}>
              {pending ? <Spinner /> : "Apply"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <p className="tnum font-display text-3xl">{fmtWhen(session.starts_at)}</p>
            <p className="mt-1 text-fg-2">
              {session.venueName ?? "Private address"} · {session.capacity} spots
            </p>
            {session.address && (
              <AddressDisplay address={session.address} audience="staff" className="mt-2" />
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {session.isPrivate && <Badge tone="ember">Private</Badge>}
              {!session.classActive && !session.isPrivate && (
                <Badge tone="neutral">Booking paused</Badge>
              )}
              {session.coachId &&
                (session.coachArrivedAt ? (
                  <Badge tone="ok">✓ Coach arrived {clockTime(session.coachArrivedAt)}</Badge>
                ) : (
                  <Badge tone="neutral">Coach not arrived yet</Badge>
                ))}
            </div>
          </div>

          {/* ── Coach (always per-session) ── */}
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
            <Button onClick={applyCoach} disabled={pending || !target} className="w-full">
              {pending ? <Spinner /> : "Change coach"}
            </Button>
          </div>

          {/* ── Everything else: one form, scoped on save ── */}
          <div className="space-y-4 rounded-[12px] border border-line p-4">
            <p className="label">{session.isPrivate ? "Move this session" : "Edit"}</p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Day"
                type="date"
                value={date}
                onChange={(e) => {
                  const newDate = e.target.value;
                  setDate(newDate);
                  const newWeekday = weekdayOfDate(newDate);
                  setForm(f => ({ ...f, weekday: newWeekday, title: generateClassTitle(f.skillLevel, newWeekday, f.time) }));
                }}
              />
              <Input
                label="Time"
                type="time"
                value={form.time}
                onChange={(e) => updateForm({ ...form, time: e.target.value })}
              />
            </div>
            {!session.isPrivate && (
              <ClassDetailFields form={form} onChange={updateForm} venues={venues} />
            )}
            <Button
              className="w-full"
              disabled={pending || (session.isPrivate ? !slotChanged : !anyChanged)}
              onClick={() => {
                setMessage(null);
                if (session.isPrivate) {
                  // Private sessions are one-offs — nothing to scope.
                  startTransition(async () => {
                    const r = await moveSession(session.id, date, form.time);
                    setMessage(
                      r.ok
                        ? "Session moved — everyone booked has been told."
                        : (r.error ?? "Move failed.")
                    );
                  });
                } else {
                  setScope(classChanged ? "class" : "session");
                  setStep("scope");
                }
              }}
            >
              {pending ? <Spinner /> : "Save changes"}
            </Button>
          </div>

          <div className="space-y-2">
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
                  const r = await cancelSession(session.id, "cancelled by academy");
                  setMessage(
                    r.ok
                      ? "Cancelled — everyone booked has been told."
                      : (r.error ?? "Cancel failed.")
                  );
                });
              }}
            >
              Cancel this session
            </Button>
            {!session.isPrivate && (
              <button
                disabled={pending}
                className="w-full text-center text-sm text-err underline-offset-4 hover:underline"
                onClick={() => {
                  if (
                    !window.confirm(
                      `End ${session.title} completely? All upcoming weeks are cancelled and everyone booked gets a message. Past sessions stay in the history.`
                    )
                  )
                    return;
                  startTransition(async () => {
                    const r = await endGroupClass(session.classId);
                    if (r.ok) {
                      setMessage("Class ended — everyone affected has been told.");
                      onClose();
                    } else setMessage(r.error ?? "Failed.");
                  });
                }}
              >
                End this class — remove every week
              </button>
            )}
          </div>
          {message && <p className="text-sm text-fg-2">{message}</p>}
        </div>
      )}
    </Sheet>
  );
}
