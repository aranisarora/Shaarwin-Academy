"use client";

// The class-detail field grid shared by every surface that edits a class:
// the session sheet ("every week" scope), the class sheet (weekly classes
// list) and the add-to-calendar sheet (new weekly class).

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { WEEKDAY_NAME } from "./admin-calendar-types";
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
  skillLevel: "any",
  capacity: 10,
  durationMinutes: 60,
  venueId: "",
  weekday: "MO",
  time: "18:30",
  coachId: "",
};

/** Auto-generate a class title from its defining attributes. */
export function generateClassTitle(skillLevel: string, weekday: string, time: string): string {
  const level =
    skillLevel === "any"
      ? "All levels"
      : skillLevel.charAt(0).toUpperCase() + skillLevel.slice(1);
  const day = WEEKDAY_NAME[weekday] ?? weekday;
  return `${level} — ${day} ${to12Hour(time)}`;
}

/** Convert a 24-hour "HH:MM" wall-time string to a 12-hour "h:MM AM/PM" label. */
function to12Hour(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

/** Description, level, venue, spots and length — everything about a class
 * except its weekly slot (day/time live with the caller). Title is derived
 * automatically and not shown as an editable field. */
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
          {["any", "beginner", "intermediate", "advanced", "elite"].map((l) => (
            <option key={l} value={l}>{l === "any" ? "any level" : l}</option>
          ))}
        </Select>
        <Select
          label="Venue"
          value={form.venueId}
          onChange={(e) => onChange({ ...form, venueId: e.target.value })}
        >
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.active ? v.name : `${v.name} (hidden)`}
            </option>
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
