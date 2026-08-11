"use client";

// One filter control, two shapes. On the phone the always-visible `<Select>`
// grids that used to sit above the schedule/weekly lists collapse into a single
// horizontally-scrollable chip row: each chip reads "All coaches ▾" until you
// pick something, then fills in ember with the chosen value and an ✕ to clear.
// Tapping a chip opens a small option sheet. On ≥1024px it stays the familiar
// inline dropdown grid, which works fine with a mouse.
//
// A filter may also take SEVERAL answers at once ("Ravi and Amit", "these two
// families"). That is opt-in per filter — `mode: "multi"` — because the two
// other screens using this bar (Book, Players) ask questions with exactly one
// answer, and turning multi on everywhere would have made every one of their
// chips need a Done tap to leave.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button";
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

/** What every filter carries, whichever shape it is. */
type FilterDefBase = {
  /** Stable key + accessible name for the control ("Filter by coach"). */
  key: string;
  aria: string;
  /** Chip text while inactive, e.g. "All coaches". */
  label: string;
  options: FilterOption[];
};

export type FilterDef =
  | (FilterDefBase & {
      /** One answer at a time. This is the shape every caller had before multi
       *  existed, so it stays the default and needs no `mode`. */
      mode?: "single";
      value: string;
      /** The value that counts as "no filter" — defaults to the first option. */
      defaultValue?: string;
      onChange: (value: string) => void;
    })
  | (FilterDefBase & {
      /** Several answers at once. An EMPTY ARRAY is "no filter", so a multi
       *  filter must NOT be given an "all" option: the sheet supplies that row
       *  itself, and an option carrying the same meaning could be ticked
       *  alongside three coaches — a filter that says both "all" and "these
       *  three" at once. */
      mode: "multi";
      values: string[];
      onChange: (values: string[]) => void;
    });

/** Both shapes flattened into the one thing the rendering below needs.
 *
 *  Written once on purpose. The chip, the desktop control and the option sheet
 *  all have to agree about what "chosen" means and what clearing does, and three
 *  copies of that agreement is exactly how a chip ends up sitting in ember with
 *  nothing actually filtered. */
type Normalised = {
  key: string;
  aria: string;
  label: string;
  options: FilterOption[];
  multi: boolean;
  /** Everything currently chosen. Empty means no filter, in both shapes. */
  chosen: string[];
  /** What the chip and the desktop control read out. */
  summary: string;
  /** The value that means "no filter" for a single filter — what its native
   *  `<select>` sits on while nothing is chosen. A multi filter says that with
   *  an empty selection instead, so only the single branch reads this. */
  fallback: string;
  /** Choose an option: sets it on a single filter, toggles it on a multi one. */
  pick: (value: string) => void;
  clear: () => void;
};

function normalise(f: FilterDef): Normalised {
  // A chosen value with no option to name it shows its raw value rather than
  // the inactive label: "All coaches" on a chip that is still filtering is the
  // one reading that lies. Callers keep the current value in their options list
  // precisely so this never has to happen.
  const labelOf = (v: string) => f.options.find((o) => o.value === v)?.label ?? v;
  const summarise = (chosen: string[]) =>
    chosen.length === 0
      ? f.label
      : chosen.length === 1
        ? labelOf(chosen[0])
        : `${labelOf(chosen[0])} +${chosen.length - 1}`;
  const common = { key: f.key, aria: f.aria, label: f.label, options: f.options };

  if (f.mode === "multi") {
    return {
      ...common,
      multi: true,
      chosen: f.values,
      summary: summarise(f.values),
      fallback: "",
      pick: (v) =>
        f.onChange(
          f.values.includes(v) ? f.values.filter((x) => x !== v) : [...f.values, v]
        ),
      clear: () => f.onChange([]),
    };
  }

  const fallback = f.defaultValue ?? f.options[0]?.value ?? "";
  const chosen = f.value === fallback ? [] : [f.value];
  return {
    ...common,
    multi: false,
    chosen,
    summary: summarise(chosen),
    fallback,
    pick: (v) => f.onChange(v),
    clear: () => f.onChange(fallback),
  };
}

/** One row of the option sheet. `aria-pressed` rather than the ✓ alone, because
 *  the tick is decoration a screen reader never sees — and on a multi filter
 *  "which of these am I already on?" is the whole question the sheet answers. */
function OptionRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`pressable flex min-h-12 w-full items-center justify-between gap-3 rounded-[8px] border px-4 text-left text-base ${
        selected
          ? "border-ember text-ember"
          : "border-line hover:border-ember active:border-ember"
      }`}
    >
      <span>{label}</span>
      {selected && <span aria-hidden>✓</span>}
    </button>
  );
}

export function FilterBar({
  filters,
  trailing,
}: {
  filters: FilterDef[];
  /** Extra chip(s) appended to the mobile row only (e.g. a map toggle). Desktop
   * hides them because the sidebar they control is always visible there. */
  trailing?: React.ReactNode;
}) {
  // Which filter's option sheet is open (null = none). Shared by the phone's
  // chips and the desktop control for a multi filter, which opens the same one.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rows = filters.map(normalise);
  const openFilter = rows.find((f) => f.key === openKey) ?? null;
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
        {rows.map((f) => {
          const active = f.chosen.length > 0;
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
                {f.summary}
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
                  onClick={f.clear}
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

      {/* ── Desktop: the inline dropdown grid ──
          A native <select> cannot hold two coaches at once, and the multiple
          attribute is a scrolling list box nobody uses on purpose — so a multi
          filter gets a button dressed as a Select (same height, border, radius)
          that opens the very sheet the phone uses. Single filters keep the real
          <select>: it is one keystroke to change with a keyboard, and swapping
          it for a sheet would cost the two screens that never asked for any of
          this. */}
      <div className="hidden gap-2 lg:grid lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {rows.map((f) =>
          f.multi ? (
            <button
              key={f.key}
              type="button"
              // The question AND the current answer, because aria-label replaces
              // everything inside the button: a screen reader would otherwise
              // hear "filter by coach" and nothing about the two coaches already
              // chosen, which the sighted version says right there on the face.
              aria-label={`${f.aria}: ${f.summary}`}
              aria-haspopup="dialog"
              onClick={() => setOpenKey(f.key)}
              className="pressable flex min-h-11 items-center justify-between gap-2 rounded-[8px] border border-line bg-surface-2 px-3 text-left text-base text-fg"
            >
              <span className="truncate">{f.summary}</span>
              <span aria-hidden className="text-xs opacity-70">
                ▾
              </span>
            </button>
          ) : (
            <Select
              key={f.key}
              aria-label={f.aria}
              value={f.chosen[0] ?? f.fallback}
              onChange={(e) => f.pick(e.target.value)}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )
        )}
      </div>

      {/* ── Option sheet for the tapped chip (or desktop control) ── */}
      <Sheet
        open={openFilter !== null}
        onClose={() => setOpenKey(null)}
        title={openFilter?.label}
      >
        {openFilter && (
          <>
            <ul className="space-y-1">
              {/* A multi filter's "All coaches" row is built here rather than
                  passed in, because it is not a value — it is the absence of
                  every value. Handed in as an option it would be tickable
                  alongside three coaches, and the chip would have to answer
                  "all, and these three?". */}
              {openFilter.multi && (
                <li>
                  <OptionRow
                    label={openFilter.label}
                    selected={openFilter.chosen.length === 0}
                    onSelect={openFilter.clear}
                  />
                </li>
              )}
              {openFilter.options.map((o) => (
                <li key={o.value}>
                  <OptionRow
                    label={o.label}
                    selected={openFilter.chosen.includes(o.value)}
                    onSelect={() => {
                      openFilter.pick(o.value);
                      // Multi stays open. Closing after each tap is what makes
                      // multi-select useless: picking a second coach would mean
                      // finding the chip and opening the sheet again.
                      if (!openFilter.multi) setOpenKey(null);
                    }}
                  />
                </li>
              ))}
            </ul>
            {/* A sheet that no longer dismisses itself needs a visible way out
                that isn't the ✕ in the corner — this is a phone, and the thumb
                is down here. */}
            {openFilter.multi && (
              <Button className="mt-4 w-full" onClick={() => setOpenKey(null)}>
                Done
              </Button>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
