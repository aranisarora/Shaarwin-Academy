"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { createGroupClass, setClassActive } from "@/app/admin/actions";
import {
  updateGroupClass,
  endGroupClass,
  deleteGroupClass,
  topUpSessions,
} from "@/app/admin/classes/actions";

export type ClassRow = {
  id: string;
  title: string;
  description: string;
  level: string;
  capacity: number;
  duration: number;
  weekday: string; // MO..SU (from the recurrence rule)
  time: string; // HH:MM academy wall clock, from the next session
  active: boolean;
  venueId: string | null;
  venueName: string | null;
};

const WEEKDAYS = [
  ["MO", "Monday"], ["TU", "Tuesday"], ["WE", "Wednesday"],
  ["TH", "Thursday"], ["FR", "Friday"], ["SA", "Saturday"], ["SU", "Sunday"],
] as const;

const WEEKDAY_NAME = Object.fromEntries(WEEKDAYS);

type FormState = {
  title: string;
  description: string;
  skillLevel: string;
  capacity: number;
  durationMinutes: number;
  venueId: string;
  weekday: string;
  time: string;
  coachId: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  skillLevel: "beginner",
  capacity: 10,
  durationMinutes: 60,
  venueId: "",
  weekday: "MO",
  time: "18:30",
  coachId: "",
};

export function ClassManager({
  classes,
  venues,
  coaches,
}: {
  classes: ClassRow[];
  venues: { id: string; name: string }[];
  coaches: { id: string; name: string }[];
}) {
  const [mode, setMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingActive, setEditingActive] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setForm({ ...EMPTY_FORM, venueId: venues[0]?.id ?? "" });
    setMode("create");
    setSheetMessage(null);
  }

  function openEdit(c: ClassRow) {
    setForm({
      title: c.title,
      description: c.description,
      skillLevel: c.level,
      capacity: c.capacity,
      durationMinutes: c.duration,
      venueId: c.venueId ?? venues[0]?.id ?? "",
      weekday: c.weekday,
      time: c.time,
      coachId: "",
    });
    setEditingId(c.id);
    setEditingActive(c.active);
    setMode("edit");
    setSheetMessage(null);
  }

  function close() {
    setMode("closed");
    setEditingId(null);
  }

  function submit() {
    setSheetMessage(null);
    startTransition(async () => {
      if (mode === "create") {
        const r = await createGroupClass(form);
        if (r.ok) {
          setMessage("Class is live — the next 8 weeks of sessions are on the calendar.");
          close();
        } else setSheetMessage(r.error ?? "Couldn't create the class.");
      } else if (editingId) {
        const r = await updateGroupClass({
          classId: editingId,
          title: form.title,
          description: form.description,
          skillLevel: form.skillLevel,
          capacity: form.capacity,
          durationMinutes: form.durationMinutes,
          venueId: form.venueId,
          weekday: form.weekday,
          time: form.time,
        });
        if (r.ok) {
          setMessage("Saved — upcoming sessions moved with it and everyone booked was told.");
          close();
        } else setSheetMessage(r.error ?? "Couldn't save the class.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="label">Group classes</p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await topUpSessions();
                setMessage(
                  r.ok
                    ? r.created
                      ? `Added ${r.created} upcoming sessions.`
                      : "The calendar is already fully topped up."
                    : (r.error ?? "Failed.")
                );
              })
            }
          >
            Top up calendar
          </Button>
          <Button onClick={openCreate}>New class</Button>
        </div>
      </div>
      <p className="text-sm text-fg-2">
        Tap a class to change it. “Top up calendar” adds the next 8 weeks of sessions for
        every running class.
      </p>
      {message && <p className="text-sm text-fg-2">{message}</p>}

      {classes.map((c) => (
        <Card key={c.id}>
          <Card.Content className="flex items-center justify-between gap-3 p-4">
            <button onClick={() => openEdit(c)} className="text-left hover:text-ember">
              <p className="font-medium">{c.title}</p>
              <p className="text-sm text-fg-2">
                {WEEKDAY_NAME[c.weekday] ?? "One-off"}s {c.time} · {c.venueName ?? "No venue"} ·{" "}
                {c.duration} min · up to {c.capacity} players
              </p>
            </button>
            <div className="flex flex-col items-end gap-1.5">
              <Badge>{c.level}</Badge>
              <button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await setClassActive(c.id, !c.active);
                  })
                }
                className={`text-xs underline-offset-4 hover:underline ${
                  c.active ? "text-ok" : "text-err"
                }`}
              >
                {c.active ? "open for booking — pause" : "paused — reopen"}
              </button>
            </div>
          </Card.Content>
        </Card>
      ))}
      {classes.length === 0 && (
        <Card>
          <Card.Content className="p-4">
            <p className="text-sm text-fg-2">No classes yet — tap “New class”.</p>
          </Card.Content>
        </Card>
      )}

      <Sheet
        open={mode !== "closed"}
        onClose={close}
        title={mode === "create" ? "New group class" : "Edit class"}
      >
        <div className="space-y-4">
          <Input
            label="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Intermediate — Spin & Serve"
          />
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            hint="Optional — shown to clients when they book."
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Level"
              value={form.skillLevel}
              onChange={(e) => setForm({ ...form, skillLevel: e.target.value })}
            >
              {["beginner", "intermediate", "advanced", "elite"].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
            <Select
              label="Venue"
              value={form.venueId}
              onChange={(e) => setForm({ ...form, venueId: e.target.value })}
            >
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
            <Input
              label="Spots"
              type="number"
              min={1}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
            />
            <Select
              label="Length"
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
            >
              {[60, 90, 120].map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </Select>
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

          {mode === "create" && (
            <Select
              label="Coach"
              hint="Leave on automatic and the best-fitting coach is picked for you."
              value={form.coachId}
              onChange={(e) => setForm({ ...form, coachId: e.target.value })}
            >
              <option value="">Automatic — pick the best fit</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          )}

          {mode === "edit" && (
            <p className="text-sm text-fg-2">
              Changing the day, time, length or venue moves every upcoming session — everyone
              booked gets a message automatically.
            </p>
          )}

          <Button
            onClick={submit}
            disabled={pending || !form.title || !form.venueId}
            className="w-full"
          >
            {pending ? <Spinner /> : mode === "create" ? "Publish class" : "Save changes"}
          </Button>

          {mode === "edit" && editingId && (
            <>
              {editingActive && (
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
                      const r = await endGroupClass(editingId);
                      if (r.ok) {
                        setMessage("Class ended — everyone affected has been told.");
                        close();
                      } else setSheetMessage(r.error ?? "Failed.");
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
                    !window.confirm(
                      "Delete this class completely? Only works if nobody ever booked it."
                    )
                  )
                    return;
                  startTransition(async () => {
                    const r = await deleteGroupClass(editingId);
                    if (r.ok) {
                      setMessage("Class deleted.");
                      close();
                    } else setSheetMessage(r.error ?? "Failed.");
                  });
                }}
              >
                Delete completely (mistakes only)
              </button>
            </>
          )}
          {sheetMessage && <p className="text-sm text-err">{sheetMessage}</p>}
        </div>
      </Sheet>
    </div>
  );
}
