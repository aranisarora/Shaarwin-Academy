"use client";

import { useEffect } from "react";

// A "needs your attention" row on Today deep-links to the exact item — not the
// generic page. On pages where the item is a row (a coach, a client), this
// scrolls that row into view and rings it briefly so the founder
// lands on the thing to fix, not a list he has to re-scan. `targetId` is the
// DOM id the page stamped on the row (e.g. `coach-<id>`, `client-<id>`).
export function DeepLinkFocus({ targetId }: { targetId: string | null }) {
  useEffect(() => {
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("deep-focus-ring");
    const t = setTimeout(() => el.classList.remove("deep-focus-ring"), 2600);
    return () => clearTimeout(t);
  }, [targetId]);
  return null;
}
