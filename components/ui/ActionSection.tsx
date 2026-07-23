"use client";

// A collapsed, tappable section inside a sheet: a label + chevron row that
// expands to reveal its form. Replaces the stacked always-open `border p-4`
// boxes that used to make every session/client sheet open six forms tall —
// now a sheet opens showing facts, and each action is one tap away. One thing
// open at a time is the caller's job (or not — several may co-exist); this just
// owns the disclosure.

import { useState } from "react";

export function ActionSection({
  label,
  summary,
  defaultOpen = false,
  tone = "neutral",
  children,
}: {
  label: string;
  /** Optional one-line preview shown on the collapsed header (e.g. a count). */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  /** "ember" draws attention to a section that needs the founder (open slot). */
  tone?: "neutral" | "ember";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const border = tone === "ember" ? "border-ember" : "border-line";
  return (
    <div className={`overflow-hidden rounded-[12px] border ${border}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="label">{label}</span>
          {summary != null && (
            <span className="truncate text-sm text-fg-2">{summary}</span>
          )}
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-fg-2 transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 py-4">{children}</div>
      )}
    </div>
  );
}
