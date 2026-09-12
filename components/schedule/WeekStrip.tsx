// Seven days, their shape, and the way to move between weeks.
//
// The list below it is vertical and chronological, which is the right way to
// read a day and a hopeless way to see a week: you cannot tell a heavy Friday
// from an empty Thursday without scrolling past both. The strip answers that
// in one glance, and pages the week while it is at it.
//
// Density is dots, capped at three. The exact count is on the day heading a
// scroll away; what this has to carry is "busy / quiet / nothing". A cancelled
// session shows as a hollow dot — the day is not empty, something was called
// off, and that is a different fact from a day we never ran.
//
// Links, not buttons. Paging a week is a new address, and a day is an anchor
// on this page; neither needs a script, so the strip is drawn on the server
// and works before anything has loaded.

import Link from "next/link";
import {
  formatWallDay,
  formatWallMonthRange,
  formatWallWeekdayNarrow,
  shiftWallDate,
} from "@/lib/academy-time";
import type { DayDensity } from "@/lib/schedule-view";

const DAYS_SHOWN = 7;

const pager =
  "pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] text-fg-2 hover:text-ember";

export function WeekStrip({
  anchor,
  today,
  days,
}: {
  /** First of the seven days shown, "YYYY-MM-DD". Not necessarily a Monday —
   *  the window is seven days from wherever you are, and "Today" parks it on
   *  today whatever weekday that is. */
  anchor: string;
  today: string;
  days: DayDensity[];
}) {
  const dates = Array.from({ length: DAYS_SHOWN }, (_, i) => shiftWallDate(anchor, i));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const isThisWeek = today >= anchor && today <= dates[DAYS_SHOWN - 1];
  const weekHref = (date: string) => (date === today ? "/schedule" : `/schedule?from=${date}`);

  return (
    <div className="rounded-[12px] border border-line bg-surface-2">
      <div className="flex items-center gap-1 px-2 pt-1.5">
        {/* 44px targets: these are the primary way to move through the week
            on a phone. */}
        <Link href={weekHref(shiftWallDate(anchor, -DAYS_SHOWN))} aria-label="Earlier week" className={pager}>
          ‹
        </Link>
        <span className="tnum min-w-0 flex-1 truncate text-center text-xs font-medium text-fg-2">
          {formatWallMonthRange(anchor, dates[DAYS_SHOWN - 1])}
        </span>
        <Link href={weekHref(shiftWallDate(anchor, DAYS_SHOWN))} aria-label="Later week" className={pager}>
          ›
        </Link>
        {/* Only worth a control when it would actually take you somewhere. */}
        {!isThisWeek && (
          <Link
            href="/schedule"
            className="pressable flex min-h-11 shrink-0 items-center rounded-[6px] px-2 text-sm font-medium text-ember hover:underline"
          >
            Today
          </Link>
        )}
      </div>

      <div className="grid grid-cols-7 gap-0.5 px-1 pb-1.5">
        {dates.map((date) => {
          const d = byDate.get(date);
          const live = d?.live ?? 0;
          const cancelled = d?.cancelled ?? 0;
          const isToday = date === today;
          const hasDay = live + cancelled > 0;
          const cell = "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-[8px] py-1";
          const inner = (
            <>
              {/* The letter comes off this date, not off the column: the window
                  begins on whatever day you are on. */}
              <span className="text-[10px] uppercase leading-none text-fg-2">
                {formatWallWeekdayNarrow(date)}
              </span>
              <span
                className={`tnum text-sm leading-none ${
                  isToday ? "font-bold text-ember" : "font-medium text-fg"
                }`}
              >
                {Number(date.slice(8, 10))}
              </span>
              <span className="flex h-1.5 items-center gap-[2px]" aria-hidden>
                {!hasDay ? (
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
            </>
          );
          // Spoken as a day, not as a digit string.
          const spoken = `${formatWallDay(date)} — ${live} class${live === 1 ? "" : "es"}${
            cancelled ? `, ${cancelled} cancelled` : ""
          }`;
          // Tapping a day scrolls the list to it rather than filtering to it:
          // he is asking "what's on Thursday", not "hide everything else". A
          // day with nothing on has nowhere to scroll to, so it is not a link.
          return hasDay ? (
            <a
              key={date}
              href={`#day-${date}`}
              aria-label={spoken}
              aria-current={isToday ? "date" : undefined}
              className={`pressable ${cell} hover:bg-surface`}
            >
              {inner}
            </a>
          ) : (
            <span key={date} aria-label={spoken} aria-current={isToday ? "date" : undefined} className={cell}>
              {inner}
            </span>
          );
        })}
      </div>
    </div>
  );
}
