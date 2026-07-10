"use client";

// The class-detail field grid shared by every surface that edits a class:
// the session sheet ("every week" scope), the class sheet (weekly classes
// list) and the add-to-calendar sheet (new weekly class).

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { Venue } from "./admin-calendar-types";

export type ClassFormState = {
  title: string;
  description: string;
  skillLevel: string;
  capacity: number;
  durationMinutes: number;
  venueId: string;
  weekday: string; // MO..SU
  time: string; // HH:MM
  coachId: string;
};

export const EMPTY_CLASS_FORM: ClassFormState = {
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

/** Title, description, level, venue, spots and length — everything about a
 * class except its weekly slot (day/time live with the caller, because the
 * session sheet uses a concrete date instead of a weekday). */
export function ClassDetailFields({
  form,
  onChange,
  venues,
}: {
  form: ClassFormState;
  onChange: (next: ClassFormState) => void;
  venues: Venue[];
}) {
  return (
    <>
      <Input
        label="Title"
        value={form.title}
        onChange={(e) => onChange({ ...form, title: e.target.value })}
        placeholder="Intermediate — Spin & Serve"
      />
      <Input
        label="Description"
        value={form.description}
        onChange={(e) => onChange({ ...form, description: e.target.value })}
        hint="Optional — shown to clients when they book."
      />
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Level"
          value={form.skillLevel}
          onChange={(e) => onChange({ ...form, skillLevel: e.target.value })}
        >
          {["beginner", "intermediate", "advanced", "elite"].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </Select>
        <Select
          label="Venue"
          value={form.venueId}
          onChange={(e) => onChange({ ...form, venueId: e.target.value })}
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
          onChange={(e) => onChange({ ...form, capacity: Number(e.target.value) })}
        />
        <Select
          label="Length"
          value={form.durationMinutes}
          onChange={(e) => onChange({ ...form, durationMinutes: Number(e.target.value) })}
        >
          {[60, 90, 120].map((d) => (
            <option key={d} value={d}>{d} min</option>
          ))}
        </Select>
      </div>
    </>
  );
}
