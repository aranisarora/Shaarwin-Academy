"use client";

// One filter control, two shapes. On the phone the always-visible `<Select>`
// grids that used to sit above the schedule/weekly lists collapse into a single
// horizontally-scrollable chip row: each chip reads "All coaches ▾" until you
// pick something, then fills in ember with the chosen value and an ✕ to clear.
// Tapping a chip opens a small option sheet. On ≥1024px it stays the familiar
// inline dropdown grid, which works fine with a mouse.

import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet } from "./Sheet";
import { Select } from "./Select";

/** Which ends of a horizontally-scrolling element have content past them.
 *  `deps` re-runs the wiring when the row's children change identity — the
 *  observer subscribes to each child, so a chip that arrives later (options
 *  loaded, a trailing control toggled) would otherwise never be measured. */
function useEdgeFade<T extends HTMLElement>(deps: React.DependencyList) {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // SLACK, not an exact comparison. Two things make scrollWidth overshoot by
    // a few pixels on a row that visibly fits: scrollLeft is fractional under a
    // zoomed viewport or a non-integer devicePixelRatio, and `.hit-slop-r` on
    // the chip's ✕ hangs an 8px pseudo-element past its own right edge, which
    // counts as scrollable overflow on the last chip. Either one leaves a fade
    // painted over an edge with nothing behind it. Anything genuinely hidden is
    // a chip, and the narrowest of those is far wider than this.
    const SLACK = 12;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft > SLACK, end: el.scrollLeft < max - SLACK });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    // Both, and neither is redundant: scroll catches the swipe, and the
    // observer catches the row itself changing width — a chip that grows when
    // it fills in with a long venue name, or the lg: breakpoint hiding it
    // entirely, which zeroes the measurement rather than leaving it stale.
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return { ref, edges };
}

type FilterOption = { value: string; label: string };

export type FilterDef = {
  /** Stable key + accessible name for the control ("Filter by coach"). */
  key: string;
  aria: string;
  /** Chip text while inactive, e.g. "All coaches". */
  label: string;
  value: string;
  /** The value that counts as "no filter" — defaults to the first option. */
  defaultValue?: string;
  options: FilterOption[];
  onChange: (value: string) => void;
};

export function FilterBar({
  filters,
  trailing,
}: {
  filters: FilterDef[];
  /** Extra chip(s) appended to the mobile row only (e.g. a map toggle). Desktop
   * hides them because the sidebar they control is always visible there. */
  trailing?: React.ReactNode;
}) {
  // Which filter's option sheet is open on mobile (null = none).
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openFilter = filters.find((f) => f.key === openKey) ?? null;
  const { ref: rowRef, edges } = useEdgeFade<HTMLDivElement>([
    filters.length,
    trailing !== undefined,
  ]);

  return (
    <>
      {/* ── Mobile: one row of chips that scrolls sideways ──
          Four chips need about 522px and a 390px phone shows ~350 of it, so
          this briefly wrapped to two and three lines instead — which fixed
          "the Status chip is invisible" by spending a third of the first
          screen on filters, above every list they filter, and made the
          Schedule and Timetable look like nothing else in the app.
          Sideways is the shape used everywhere else (Book, the slot picker,
          the week strip), so it is the shape here.

          What makes the off-screen chip discoverable is the pair below it:
          the row is scroll-snapped so a swipe lands on a chip boundary rather
          than halfway through a word, and `.scroll-x-fade-*` softens whichever
          edge still has something behind it. A hard-cut chip at a hard edge
          reads as the end of the row; a faded one does not. */}
      <div
        ref={rowRef}
        className={`scroll-x -mx-1 flex snap-x snap-proximity gap-2 px-1 pb-1 lg:hidden ${
          edges.start ? "scroll-x-fade-s" : ""
        } ${edges.end ? "scroll-x-fade-e" : ""}`}
      >
        {filters.map((f) => {
          const fallback = f.defaultValue ?? f.options[0]?.value;
          const active = f.value !== fallback;
          const current = f.options.find((o) => o.value === f.value);
          return (
            // The squeeze lives on the whole chip, not on its two halves —
            // :active reaches ancestors, so pressing either part moves the one
            // thing the eye reads as a single control.
            <div
              key={f.key}
              className={`pressable inline-flex shrink-0 snap-start items-center rounded-full border text-sm font-medium ${
                active ? "border-ember text-ember" : "border-line text-fg-2"
              }`}
            >
              <button
                type="button"
                onClick={() => setOpenKey(f.key)}
                className="min-h-11 whitespace-nowrap rounded-l-full py-1.5 pl-3.5 pr-2"
              >
                {active ? (current?.label ?? f.label) : f.label}
                <span aria-hidden className="ml-1 text-xs opacity-70">
                  ▾
                </span>
              </button>
              {active && (
                // Roughly 26px wide and sharing an edge with the button that
                // opens the sheet — the one control on this row where a mis-tap
                // costs you the filter you just set. hit-slop-r widens the
                // target outward, away from that shared edge, so the chip stays
                // the size it looks and neither half steals the other's taps.
                <button
                  type="button"
                  aria-label={`Clear ${f.label}`}
                  onClick={() => f.onChange(fallback)}
                  className="hit-slop-r min-h-11 rounded-r-full pl-1 pr-3 text-fg-2 hover:text-ember active:text-ember"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        {trailing}
      </div>

      {/* ── Desktop: the inline dropdown grid, unchanged ── */}
      <div className="hidden gap-2 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {filters.map((f) => (
          <Select
            key={f.key}
            aria-label={f.aria}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ))}
      </div>

      {/* ── Mobile option sheet for the tapped chip ── */}
      <Sheet
        open={openFilter !== null}
        onClose={() => setOpenKey(null)}
        title={openFilter?.label}
      >
        {openFilter && (
          <ul className="space-y-1">
            {openFilter.options.map((o) => {
              const selected = o.value === openFilter.value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => {
                      openFilter.onChange(o.value);
                      setOpenKey(null);
                    }}
                    className={`pressable flex min-h-12 w-full items-center justify-between gap-3 rounded-[8px] border px-4 text-left text-base ${
                      selected
                        ? "border-ember text-ember"
                        : "border-line hover:border-ember active:border-ember"
                    }`}
                  >
                    <span>{o.label}</span>
                    {selected && <span aria-hidden>✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </>
  );
}
