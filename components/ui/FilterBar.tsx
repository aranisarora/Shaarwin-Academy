"use client";

// One filter control, two shapes. On the phone the always-visible `<Select>`
// grids that used to sit above the schedule/weekly lists collapse into a single
// horizontally-scrollable chip row: each chip reads "All coaches ▾" until you
// pick something, then fills in ember with the chosen value and an ✕ to clear.
// Tapping a chip opens a small option sheet. On ≥1024px it stays the familiar
// inline dropdown grid, which works fine with a mouse.

import { useState } from "react";
import { Sheet } from "./Sheet";
import { Select } from "./Select";

export type FilterOption = { value: string; label: string };

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

  return (
    <>
      {/* ── Mobile: one scrollable chip row ── */}
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filters.map((f) => {
          const fallback = f.defaultValue ?? f.options[0]?.value;
          const active = f.value !== fallback;
          const current = f.options.find((o) => o.value === f.value);
          return (
            <div
              key={f.key}
              className={`inline-flex shrink-0 items-center rounded-full border text-sm font-medium ${
                active ? "border-ember text-ember" : "border-line text-fg-2"
              }`}
            >
              <button
                type="button"
                onClick={() => setOpenKey(f.key)}
                className="min-h-9 whitespace-nowrap py-1.5 pl-3.5 pr-2"
              >
                {active ? (current?.label ?? f.label) : f.label}
                <span aria-hidden className="ml-1 text-xs opacity-70">
                  ▾
                </span>
              </button>
              {active && (
                <button
                  type="button"
                  aria-label={`Clear ${f.label}`}
                  onClick={() => f.onChange(fallback)}
                  className="min-h-9 pl-1 pr-3 text-fg-2 hover:text-ember"
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
                    className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-[8px] border px-4 text-left text-base ${
                      selected
                        ? "border-ember text-ember"
                        : "border-line hover:border-ember"
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
