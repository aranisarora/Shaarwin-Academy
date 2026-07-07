"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Bottom sheet on <768px, right side-panel on desktop.
 * Controlled: pass `open` + `onClose`.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass inline closures; keep the latest one in a ref so the effect
  // below depends only on `open` — re-running it on every parent render would
  // steal focus from inputs inside the sheet on each keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Close"
        className="sheet-backdrop absolute inset-0 bg-ink/60"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="sheet-panel-bottom md:sheet-panel-side absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[12px] border-t border-line bg-surface-2 shadow-[var(--shadow-sheet)] md:inset-x-auto md:inset-y-0 md:right-0 md:h-full md:max-h-none md:w-[440px] md:rounded-none md:border-l md:border-t-0"
        data-mood="studio"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line md:hidden" />
        {title && (
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-display text-xl">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close sheet"
              className="flex h-11 w-11 items-center justify-center rounded-[8px] text-fg-2 hover:text-fg"
            >
              ✕
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
