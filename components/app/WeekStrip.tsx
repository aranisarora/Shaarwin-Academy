"use client";

// Seven days, their shape, and the way to move between weeks — one control
// where there used to be a pager that could only say which week you were on.
//
// The list below it is vertical and chronological, which is the right way to
// read a day and a hopeless way to see a week: you cannot tell a heavy Friday
// from an empty Thursday without scrolling past both. The strip answers that in
// one glance, and takes over paging while it is at it, so the header does not
// grow a row to gain a capability.
//
// Density is dots, capped at three. The exact count is on the day heading a
// scroll away; what this has to carry is "busy / quiet / nothing", and a number
// small enough to fit here is a number too small to read at a glance anyway.
// A cancelled session shows as a hollow dot — the day is not empty, something
// was called off, and that is a different fact from a day we never ran.

import { useRef } from "react";
import { formatWallMonthRange, shiftWallDate } from "@/lib/academy-time";

export type DayDensity = {
  /** Academy wall date, "YYYY-MM-DD". */
  date: string;
  /** Sessions still standing. */
  live: number;
  /** Sessions called off — shown, because a hole you can't explain is worse. */
  cancelled: number;
};

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export function WeekStrip({
  anchor,
  today,
  days,
  pending = false,
  onShift,
  onToday,
  onPick,
  selected,
}: {
  /** First day of the shown week, "YYYY-MM-DD". */
  anchor: string;
  today: string;
  days: DayDensity[];
  pending?: boolean;
  onShift: (deltaDays: number) => void;
  onToday: () => void;
  /** Tapping a day scrolls the list to it. */
  onPick: (date: string) => void;
  /** The day the list is parked on, if any — drawn as a ring. */
  selected?: string | null;
}) {
  const dates = LETTERS.map((_, i) => shiftWallDate(anchor, i));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const isThisWeek = anchor === today || (today >= anchor && today <= dates[6]);

  // Swipe to page weeks. Guarded on the horizontal beating the vertical so a
  // thumb scrolling the list past the strip doesn't throw it into another week.
  const touch = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className="rounded-[12px] border border-line bg-surface-2"
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start || pending) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy)) return;
        onShift(dx < 0 ? 7 : -7);
      }}
    >
      <div className="flex items-center gap-1 px-2 pt-1.5">
        <button
          type="button"
          onClick={() => onShift(-7)}
          disabled={pending}
          aria-label="Earlier week"
          className="pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-fg-2 hover:text-ember disabled:opacity-50"
        >
          ‹
        </button>
        <span className="tnum min-w-0 flex-1 truncate text-center text-xs font-medium text-fg-2">
          {formatWallMonthRange(anchor, dates[6])}
          {pending ? " …" : ""}
        </span>
        <button
          type="button"
          onClick={() => onShift(7)}
          disabled={pending}
          aria-label="Later week"
          className="pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-fg-2 hover:text-ember disabled:opacity-50"
        >
          ›
        </button>
        {/* Only worth a control when it would actually take you somewhere. */}
        {!isThisWeek && (
          <button
            type="button"
            onClick={onToday}
            disabled={pending}
            className="pressable shrink-0 rounded-[6px] px-1.5 text-xs font-medium text-ember hover:underline disabled:opacity-50"
          >
            Today
          </button>
        )}
      </div>

      <div className="grid grid-cols-7 gap-0.5 px-1 pb-1.5">
        {dates.map((date, i) => {
          const d = byDate.get(date);
          const live = d?.live ?? 0;
          const cancelled = d?.cancelled ?? 0;
          const isToday = date === today;
          const isSelected = selected === date;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onPick(date)}
              aria-label={`${date} — ${live} class${live === 1 ? "" : "es"}${
                cancelled ? `, ${cancelled} cancelled` : ""
              }`}
              aria-current={isToday ? "date" : undefined}
              className={`pressable flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-[8px] py-1 ${
                isSelected ? "bg-surface ring-1 ring-ember" : "hover:bg-surface"
              }`}
            >
              <span className="text-[10px] uppercase leading-none text-fg-2">
                {LETTERS[i]}
              </span>
              <span
                className={`tnum text-sm leading-none ${
                  isToday ? "font-bold text-ember" : "font-medium text-fg"
                }`}
              >
                {Number(date.slice(8, 10))}
              </span>
              {/* Three dots is the whole vocabulary: more than that and the eye
                  starts counting instead of scanning. */}
              <span className="flex h-1.5 items-center gap-[2px]" aria-hidden>
                {live === 0 && cancelled === 0 ? (
                  <span className="text-[9px] leading-none text-fg-2/40">·</span>
                ) : (
                  <>
                    {Array.from({ length: Math.min(live, 3) }).map((_, n) => (
                      <span key={n} className="h-1 w-1 rounded-full bg-fg-2/60" />
                    ))}
                    {cancelled > 0 && (
                      <span className="h-1 w-1 rounded-full border border-fg-2/60" />
                    )}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
