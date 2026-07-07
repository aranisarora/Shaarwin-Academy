"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tap-to-toggle explainer for the rare term that still needs one.
 * Works on touch (no hover dependency); closes on outside tap or Escape.
 */
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label="What does this mean?"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line text-[11px] font-semibold text-fg-2 hover:border-ember hover:text-ember"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-40 mt-2 w-56 -translate-x-1/2 rounded-[8px] border border-line bg-surface-2 p-3 text-left text-sm font-normal normal-case tracking-normal text-fg shadow-[var(--shadow-sheet)]"
        >
          {text}
        </span>
      )}
    </span>
  );
}
