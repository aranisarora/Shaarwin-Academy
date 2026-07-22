"use client";

// The class-detail field grid shared by every surface that edits a class:
// the session sheet ("every week" scope), the class sheet (weekly classes
// list) and the add-to-calendar sheet (new weekly class).

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TimeSelect12h } from "./TimeSelect12h";
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

/** "18:30" → "6:30 pm" — 12-hour rendering of a 24h wall-clock string. */
export function time12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h)) return time;
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${period}`;
}

/** Auto-generate a class title from its schedule. */
export function generateClassTitle(weekday: string, time: string, venueName?: string): string {
  const day = WEEKDAY_NAME[weekday] ?? weekday;
  return venueName ? `${day} ${time12h(time)} · ${venueName}` : `${day} ${time12h(time)}`;
}

/** One time picker per selected item (a weekday code or an ISO date) — used
 * wherever a multi-select needs a distinct time for each pick. `onRemove`
 * adds a ✕ per row; omit it when the caller has its own toggle (day chips). */
export function ItemTimesList({
  items,
  labelOf,
  times,
  onSetTime,
  onRemove,
}: {
  items: string[];
  labelOf: (item: string) => string;
  times: Record<string, string>;
  onSetTime: (item: string, time: string) => void;
  onRemove?: (item: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item}
          className="flex items-center gap-3 rounded-[12px] border border-line bg-surface-2 px-3 py-2.5"
        >
          <span className="w-24 shrink-0 text-sm font-medium">{labelOf(item)}</span>
          <div className="flex-1">
            <TimeSelect12h
              value={times[item] ?? "18:30"}
              onChange={(t) => onSetTime(item, t)}
            />
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(item)}
              className="text-fg-2 hover:text-err"
              aria-label={`Remove ${labelOf(item)}`}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Venue, spots and length — everything about a class except its weekly slot
 * (day/time live with the caller). Level is not surfaced here since it is not
 * meaningful for this academy. Title is derived automatically. */
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
        <Select
          label="Length"
          value={form.durationMinutes}
          onChange={(e) => onChange({ ...form, durationMinutes: Number(e.target.value) })}
        >
          {[60, 90, 120].map((d) => (
            <option key={d} value={d}>{d} min</option>
          ))}
        </Select>
        <Input
          label="Spots"
          type="number"
          min={1}
          value={form.capacity}
          onChange={(e) => onChange({ ...form, capacity: Number(e.target.value) })}
        />
      </div>
    </>
  );
}
