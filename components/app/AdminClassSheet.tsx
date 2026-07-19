"use client";

// Class editor for the weekly-classes list on the admin calendar. Everything
// here applies to every week of the class (the calendar's session sheet is
// where one-week-only changes happen).

import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { setClassActive } from "@/app/admin/actions";
import {
  deleteGroupClass,
  endGroupClass,
  reassignClassCoach,
  restoreGroupClass,
  updateGroupClass,
} from "@/app/admin/schedule/actions";
import { ClassDetailFields, generateClassTitle, type ClassFormState } from "./ClassFields";
import { TimeSelect12h } from "./TimeSelect12h";
import { WEEKDAYS, type ClassRow, type Coach, type Venue } from "./admin-calendar-types";

export function AdminClassSheet({
  cls,
  coaches,
  venues,
  onClose,
  onDone,
}: {
  cls: ClassRow;
  coaches: Coach[];
  venues: Venue[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // Mounted fresh per class (parent keys on cls.id), so initializers read the
  // class directly — no prop-sync effects.
  const [form, setForm] = useState<ClassFormState>({
    title: generateClassTitle(cls.weekday, cls.time, cls.venueName ?? undefined),
    description: cls.description,
    skillLevel: cls.level,
    capacity: cls.capacity,
    durationMinutes: cls.duration,
    venueId: cls.venueId ?? venues[0]?.id ?? "",
    weekday: cls.weekday,
    time: cls.time,
    coachId: "",
  });

  function updateForm(next: ClassFormState) {
    const venueName = venues.find((v) => v.id === next.venueId)?.name;
    setForm({ ...next, title: generateClassTitle(next.weekday, next.time, venueName) });
  }
  const [coachTarget, setCoachTarget] = useState("");
  const [lock, setLock] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ended = !cls.active && !!cls.endsOn;

  function applyCoach() {
    if (!coachTarget) return;
    startTransition(async () => {
      let r = await reassignClassCoach(cls.id, coachTarget, lock);
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
        r = await reassignClassCoach(cls.id, coachTarget, lock, true);
      }
      if (r.ok) {
        onDone(
          r.skipped
            ? `Coach set on ${r.changed} upcoming sessions — ${r.skipped} couldn't take them (clashes) and kept their coach.`
            : "Coach set for every upcoming week — everyone affected has been told."
        );
      } else setMessage(r.error ?? "Failed.");
    });
  }

  return (
    <Sheet open onClose={onClose} title="Edit class">
      <div className="space-y-4">
        {ended && (
          <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-4">
            <p className="text-sm text-fg-2">
              This class has ended — its upcoming sessions were cancelled. Restore it and
              they go back on the schedule (clients who were booked need to book again).
            </p>
            <Button
              className="w-full"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await restoreGroupClass(cls.id);
                  if (r.ok)
                    onDone("Class restored — its upcoming sessions are back on the schedule.");
                  else setMessage(r.error ?? "Couldn't restore the class.");
                })
              }
            >
              {pending ? <Spinner /> : "Restore class"}
            </Button>
          </div>
        )}

        <ClassDetailFields form={form} onChange={updateForm} venues={venues} />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Day"
            value={form.weekday}
            onChange={(e) => updateForm({ ...form, weekday: e.target.value })}
          >
            {WEEKDAYS.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </Select>
          <TimeSelect12h
            label="Time"
            value={form.time}
            onChange={(time) => updateForm({ ...form, time })}
          />
        </div>

        <p className="text-sm text-fg-2">
          Changes here apply to every week of this class. Moving the day, time, length or
          venue moves every upcoming session — everyone booked gets a message automatically.
        </p>

        <Button
          className="w-full"
          disabled={pending || !form.venueId}
          onClick={() =>
            startTransition(async () => {
              const r = await updateGroupClass({
                classId: cls.id,
                title: form.title,
                description: form.description,
                skillLevel: form.skillLevel,
                capacity: form.capacity,
                durationMinutes: form.durationMinutes,
                venueId: form.venueId,
                weekday: form.weekday,
                time: form.time,
              });
              if (r.ok)
                onDone("Saved — upcoming sessions moved with it and everyone booked was told.");
              else setMessage(r.error ?? "Couldn't save the class.");
            })
          }
        >
          {pending ? <Spinner /> : "Save changes"}
        </Button>

        {!ended && (
          <div className="space-y-3 rounded-[12px] border border-line p-4">
            <p className="label">Coach — every week</p>
            <Select
              label="Coach"
              hint="Puts this coach on every upcoming session of the class."
              value={coachTarget}
              onChange={(e) => setCoachTarget(e.target.value)}
            >
              <option value="">— pick a coach —</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
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
            <Button
              onClick={applyCoach}
              disabled={pending || !coachTarget}
              className="w-full"
            >
              {pending ? <Spinner /> : "Set coach for every week"}
            </Button>
          </div>
        )}

        {!ended && (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await setClassActive(cls.id, !cls.active);
                if (r.ok)
                  onDone(cls.active ? "Booking paused for this class." : "Class reopened for booking.");
                else setMessage(r.error ?? "Failed.");
              })
            }
            className={`w-full text-center text-sm underline-offset-4 hover:underline ${
              cls.active ? "text-ok" : "text-err"
            }`}
          >
            {cls.active ? "Open for booking — pause it" : "Paused — reopen for booking"}
          </button>
        )}

        {cls.active && (
          <Button
            variant="destructive"
            disabled={pending}
            className="w-full"
            onClick={() => {
              if (
                !window.confirm(
                  "End this class? All upcoming sessions are cancelled and everyone booked gets a message. Past sessions stay in the history — and you can restore the class later from this list."
                )
              )
                return;
              startTransition(async () => {
                const r = await endGroupClass(cls.id);
                if (r.ok) onDone("Class ended — everyone affected has been told. You can restore it from the weekly classes list.");
                else setMessage(r.error ?? "Failed.");
              });
            }}
          >
            End class
          </Button>
        )}
        <button
          disabled={pending}
          className="w-full text-center text-sm text-fg-2 underline-offset-4 hover:underline"
          onClick={() => {
            if (
              !window.confirm("Delete this class completely? Only works if nobody ever booked it.")
            )
              return;
            startTransition(async () => {
              const r = await deleteGroupClass(cls.id);
              if (r.ok) onDone("Class deleted.");
              else setMessage(r.error ?? "Failed.");
            });
          }}
        >
          Delete completely (mistakes only)
        </button>
        {message && <p className="text-sm text-err">{message}</p>}
      </div>
    </Sheet>
  );
}
