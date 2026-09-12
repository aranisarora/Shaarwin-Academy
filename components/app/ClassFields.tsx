"use client";

// The class-detail field grid shared by every surface that edits a class:
// the session sheet ("every week" scope), the class sheet (weekly classes
// list) and the add-to-calendar sheet (new weekly class).

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TimeSelect12h } from "./TimeSelect12h";
import { WEEKDAY_NAME } from "./admin-calendar-types";
import { venueDisplayName } from "@/lib/venue-display";
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

/**
 * How long a class runs — ONE list, everywhere.
 *
 * There used to be three: the add sheet offered up to 240 for a group and up to
 * 360 for a school block, and every editor offered exactly [60, 90, 120]. So
 * over half the live timetable — every class at 150, 240 or 360 — opened its
 * editor with a `value` that matched no `<option>`, which renders the field
 * BLANK. The value survived an untouched save, but the founder could not read
 * it, and one stray tap on the control silently shortened a four-hour school
 * block to two and re-timed every upcoming session.
 *
 * A school block is a group class that runs longer. That is not two questions,
 * so it is no longer two lists.
 */
export const DURATIONS = [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];

/** The list, guaranteed to contain what the class actually holds. The database
 *  allows any value from 30 to 360, so a class seeded from elsewhere must still
 *  be able to show itself. */
export function durationOptions(current: number): number[] {
  return DURATIONS.includes(current)
    ? DURATIONS
    : [...DURATIONS, current].sort((a, b) => a - b);
}

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
 * adds a ✕ per row; omit it when the caller has its own toggle (day chips).
 *
 * The label sits ABOVE the picker rather than in a 96px column beside it. In a
 * column it left the three time controls ~58px each on a 390px phone; stacked,
 * they get the full width of the card. It costs one line per row and it is the
 * difference between a picker you can read and one you aim at.
 *
 * `noteOf` puts a line under the picker saying what is already in that slot.
 * It belongs on the row rather than in one block at the foot of the sheet
 * because the founder picks several days at once, and "Ravi is busy" is
 * useless unless it is attached to the Tuesday it is about. `railOf` draws the
 * ember left edge on a row whose note is about the coach — the one thing on
 * this screen with a consequence he might want to act on. */
export function ItemTimesList({
  items,
  labelOf,
  times,
  onSetTime,
  onRemove,
  noteOf,
  railOf,
}: {
  items: string[];
  labelOf: (item: string) => string;
  times: Record<string, string>;
  onSetTime: (item: string, time: string) => void;
  onRemove?: (item: string) => void;
  noteOf?: (item: string) => React.ReactNode;
  railOf?: (item: string) => boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const note = noteOf?.(item);
        const name = labelOf(item);
        return (
          <div
            key={item}
            className={`flex flex-col gap-2 rounded-[12px] border border-line bg-surface-2 px-3 py-2.5 ${
              railOf?.(item) ? "border-l-[3px] border-l-ember" : ""
            }`}
          >
            <div className="flex min-h-11 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{name}</span>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(item)}
                  className="pressable -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-fg-2 hover:text-err"
                  aria-label={`Remove ${name}`}
                >
                  ✕
                </button>
              )}
            </div>
            <TimeSelect12h
              label={undefined}
              value={times[item] ?? "18:30"}
              onChange={(t) => onSetTime(item, t)}
            />
            {note != null && <div className="text-sm text-fg-2">{note}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Location, spots and length — everything about a class except its weekly slot
 * (day/time live with the caller). Level is not surfaced here since it is not
 * meaningful for this academy. Title is derived automatically.
 *
 * "Location", not "Venue". The add sheet called this same control Location, the
 * filters on both views call it Location, the cards say "Location TBC" — and
 * only the editors said Venue. Half of what it lists are families' own homes,
 * which are locations and are not venues.
 *
 * Names come from `venueDisplayName`, which exists because one complex can hold
 * several mutually inaccessible venues — a resident of the villas cannot get
 * into the towers' clubhouse. It was called in exactly one of the four venue
 * pickers, so everywhere else two different halls rendered as the same option.
 *
 * Description is gone from both places it appeared. It was optional, it was
 * never filled in, and it cost two lines of a form the founder fills in on a
 * phone between classes. A field nobody uses is not free: it is one more thing
 * to read past on the way to the one that matters. The column stays on the
 * table for the classes that already have one. */
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
    <div className="grid grid-cols-2 gap-3">
      <Select
        label="Location"
        className="col-span-2"
        value={form.venueId}
        onChange={(e) => onChange({ ...form, venueId: e.target.value })}
      >
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.is_public ? venueDisplayName(v) : `${venueDisplayName(v)} (hidden)`}
          </option>
        ))}
      </Select>
      <Select
        label="Length"
        value={form.durationMinutes}
        onChange={(e) => onChange({ ...form, durationMinutes: Number(e.target.value) })}
      >
        {durationOptions(form.durationMinutes).map((d) => (
          <option key={d} value={d}>
            {d} min
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
    </div>
  );
}
