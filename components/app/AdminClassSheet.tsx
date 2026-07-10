"use client";

// Class editor for the weekly-classes list on the admin calendar. Everything
// here applies to every week of the class (the calendar's session sheet is
// where one-week-only changes happen).

import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { setClassActive } from "@/app/admin/actions";
import { deleteGroupClass, endGroupClass, updateGroupClass } from "@/app/admin/calendar/actions";
import { ClassDetailFields, type ClassFormState } from "./ClassFields";
import { WEEKDAYS, type ClassRow, type Venue } from "./admin-calendar-types";

export function AdminClassSheet({
  cls,
  venues,
  onClose,
  onDone,
}: {
  cls: ClassRow;
  venues: Venue[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // Mounted fresh per class (parent keys on cls.id), so initializers read the
  // class directly — no prop-sync effects.
  const [form, setForm] = useState<ClassFormState>({
    title: cls.title,
    description: cls.description,
    skillLevel: cls.level,
    capacity: cls.capacity,
    durationMinutes: cls.duration,
    venueId: cls.venueId ?? venues[0]?.id ?? "",
    weekday: cls.weekday,
    time: cls.time,
    coachId: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Sheet open onClose={onClose} title="Edit class">
      <div className="space-y-4">
        <ClassDetailFields form={form} onChange={setForm} venues={venues} />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Day"
            value={form.weekday}
            onChange={(e) => setForm({ ...form, weekday: e.target.value })}
          >
            {WEEKDAYS.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </Select>
          <Input
            label="Time"
            type="time"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
          />
        </div>

        <p className="text-sm text-fg-2">
          Changes here apply to every week of this class. Moving the day, time, length or
          venue moves every upcoming session — everyone booked gets a message automatically.
        </p>

        <Button
          className="w-full"
          disabled={pending || !form.title || !form.venueId}
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

        {cls.active && (
          <Button
            variant="destructive"
            disabled={pending}
            className="w-full"
            onClick={() => {
              if (
                !window.confirm(
                  "End this class? All upcoming sessions are cancelled and everyone booked gets a message. Past sessions stay in the history."
                )
              )
                return;
              startTransition(async () => {
                const r = await endGroupClass(cls.id);
                if (r.ok) onDone("Class ended — everyone affected has been told.");
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
