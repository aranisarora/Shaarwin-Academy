"use client";

// The bottom toast, and the one spot it is allowed to sit in.
//
// That spot is `bottom-[calc(env(safe-area-inset-bottom)+4.75rem)]` — clear of
// the tab bar on a phone, clear of nothing on desktop (lg:bottom-6). It was
// written out by hand in three places, which is two places too many for a
// magic number that has to agree with the height of the tab bar.
//
// Everything pinned there shares the anchor and takes turns: a status line, a
// success line, and the selection bar are mutually exclusive by construction,
// because two of them stacked would put one on top of the button the founder
// is reaching for.

import { useEffect, useState } from "react";

/** The one position. Compose it; don't retype it. */
export const TOAST_ANCHOR =
  "fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 mx-auto max-w-md lg:bottom-6";

/** The anchor with nothing else — for things that bring their own skin (the
 *  selection bar, a wrapped <ActionResult>). */
export function ToastSlot({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`${TOAST_ANCHOR} ${className}`}>{children}</div>;
}

/** A plain status line. Neutral on purpose: a success gets <ActionResult>'s
 *  green tick instead, and red is reserved for "you must act now". */
export function Toast({ children }: { children: React.ReactNode }) {
  return (
    // role=status + aria-live=polite: this is the only report the founder gets
    // that a thing happened, and it used to be announced to nobody.
    <div
      role="status"
      aria-live="polite"
      className={`${TOAST_ANCHOR} rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2 shadow-[var(--shadow-sheet)]`}
    >
      {children}
    </div>
  );
}

/**
 * A message that clears itself, so it never reserves layout space above a list
 * and never has to be dismissed. Returns the same pair `useState` would, and
 * the timer restarts whenever the message changes — setting a second message
 * while the first is still up gives the second its own full five seconds.
 */
export function useAutoClearMessage(
  ms = 5000
): [string | null, (message: string | null) => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), ms);
    return () => clearTimeout(t);
  }, [message, ms]);
  return [message, setMessage];
}
