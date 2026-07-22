"use client";

// 12-hour time picker — hour / minutes / am-pm selects that read and emit the
// canonical 24-hour "HH:MM" wall-clock string the rest of the app speaks.
// Replaces <input type="time">, whose display format follows the OS locale and
// can't be forced to a 12-hour clock.

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
    "min-h-11 rounded-[8px] border border-line bg-surface-2 px-2 text-base text-fg";

  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="label">{label}</span>}
      <div className="grid grid-cols-3 gap-2">
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
        <select
          aria-label={`${aria} — minutes`}
          className={selectClass}
          value={minute}
          onChange={(e) => emit(h12, Number(e.target.value), period)}
        >
          {minutes.map((m) => (
            <option key={m} value={m}>
              :{String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
        <select
          aria-label={`${aria} — am or pm`}
          className={selectClass}
          value={period}
          onChange={(e) => emit(h12, minute, e.target.value as "am" | "pm")}
        >
          <option value="am">am</option>
          <option value="pm">pm</option>
        </select>
      </div>
    </div>
  );
}
