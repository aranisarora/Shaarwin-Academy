"use client";

// The row of seven weekday chips — Mon…Sun — wherever a day is picked.
//
// It was written out four times: twice in the add sheet, once in the private
// slot editor, and not at all in the group class editor, which used a <Select>
// instead. So the same question had two different shapes depending on which
// sheet you were in, and one of the four copies (the group half of the add
// sheet) was 32px tall with no press feedback while the other three were 44px
// with it — the same control, in the same sheet, two sizes.
//
// One component now. Single-select and multi-select are the same row with the
// same targets; only the semantics change, and they change correctly:
// mutually-exclusive days are radios, independent ones are toggles.

import { WEEKDAYS } from "./admin-calendar-types";

export function DayChips({
  selected,
  onSelect,
  multiple = false,
  label = "Day",
}: {
  /** Weekday codes currently on. Single-select callers pass one. */
  selected: string[];
  /** Fired with the tapped code — the caller decides set vs toggle. */
  onSelect: (code: string) => void;
  multiple?: boolean;
  /** Names the group for a screen reader; the caller draws the visible label. */
  label?: string;
}) {
  return (
    <div
      role={multiple ? "group" : "radiogroup"}
      aria-label={label}
      className="flex flex-wrap gap-2"
    >
      {WEEKDAYS.map(([code, name]) => {
        const on = selected.includes(code);
        return (
          <button
            key={code}
            type="button"
            {...(multiple
              ? { "aria-pressed": on }
              : { role: "radio", "aria-checked": on })}
            aria-label={name}
            onClick={() => onSelect(code)}
            className={`pressable min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${
              on ? "border-ember bg-ember text-ivory" : "border-line hover:border-ember"
            }`}
          >
            {name.slice(0, 3)}
          </button>
        );
      })}
    </div>
  );
}
