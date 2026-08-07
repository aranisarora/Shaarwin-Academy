"use client";

// 12-hour time picker — reads and emits the canonical 24-hour "HH:MM" wall-clock
// string the rest of the app speaks. Replaces <input type="time">, whose display
// format follows the OS locale and can't be forced to a 12-hour clock.
//
// It used to be three equal dropdowns in a `grid-cols-3`, which is fine at full
// width and unusable everywhere it was actually put: dropped into a half-column
// beside a Day select it gave each one 51px, of which ~16px is the native arrow
// — about 17px of room for "12", ":55" and "pm" at 16px type. All three clipped.
//
// Two changes fix it for good:
//
//   • am/pm is a two-button toggle, not a third dropdown. It is a binary choice
//     and it was the widest thing competing for the narrowest space; as a
//     toggle both answers are visible, each is a 44px target, and one tap
//     switches instead of open-scan-pick. It also drops a tab stop.
//   • The two remaining selects flex, so the control fills whatever it is given
//     rather than dividing it three ways.
//
// It still must not be put in a half-column — `fullWidth` rows are the only
// call sites now — but it no longer falls apart if it ends up in a narrow one.

const MINUTE_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function parse(value: string): { h24: number; minute: number } {
  const [h, m] = value.split(":").map(Number);
  return {
    h24: Number.isFinite(h) ? Math.min(Math.max(h, 0), 23) : 18,
    minute: Number.isFinite(m) ? Math.min(Math.max(m, 0), 59) : 0,
  };
}

export function TimeSelect12h({
  label,
  value,
  onChange,
}: {
  /** Omit to render the pickers bare — the caller provides its own label. */
  label?: string;
  value: string; // "HH:MM" 24h
  onChange: (next: string) => void;
}) {
  const aria = label || "Time";
  const { h24, minute } = parse(value);
  const period: "am" | "pm" = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  // Keep an off-step minute (e.g. a session at :37) selectable rather than
  // silently snapping it.
  const minutes = MINUTE_STEPS.includes(minute)
    ? MINUTE_STEPS
    : [...MINUTE_STEPS, minute].sort((a, b) => a - b);

  function emit(nextH12: number, nextMinute: number, nextPeriod: "am" | "pm") {
    const h = nextPeriod === "pm" ? (nextH12 % 12) + 12 : nextH12 % 12;
    onChange(`${String(h).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`);
  }

  const selectClass =
    "min-h-11 min-w-0 flex-1 rounded-[8px] border border-line bg-surface-2 px-2 text-base text-fg";

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="label">{label}</span>}
      <div className="flex items-center gap-2">
        <select
          aria-label={`${aria} — hour`}
          className={selectClass}
          value={h12}
          onChange={(e) => emit(Number(e.target.value), minute, period)}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span aria-hidden className="shrink-0 text-fg-2">
          :
        </span>
        <select
          aria-label={`${aria} — minutes`}
          className={selectClass}
          value={minute}
          onChange={(e) => emit(h12, Number(e.target.value), period)}
        >
          {minutes.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
        {/* Both answers visible, one tap to switch. radiogroup rather than two
            aria-pressed buttons, because they are mutually exclusive and a
            screen reader should say "am, 1 of 2" rather than announcing two
            unrelated toggles. */}
        <div
          role="radiogroup"
          aria-label={`${aria} — am or pm`}
          className="flex shrink-0 overflow-hidden rounded-[8px] border border-line"
        >
          {(["am", "pm"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => emit(h12, minute, p)}
              className={`pressable min-h-11 px-3 text-base font-medium ${
                period === p
                  ? "bg-ember text-ivory"
                  : "bg-surface-2 text-fg-2 hover:text-ember"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
