"use client";

// The one thing waiting on the founder, put in front of him on arrival.
//
// Same shape as the coach's version (CoachActionSheet): one question, opened on
// mount, dismissible per visit and back on the next app open until it is dealt
// with. The coach's exists because a session he hasn't confirmed is a class
// that may not happen; this exists because a family locked out of the app, or a
// class with nobody to teach it, is the same kind of silence.
//
// It fires only when ONE thing is top of the queue. Two red rows is not an
// interruption, it is a list — and a popup that greets him every morning is one
// he learns to dismiss without reading, which costs the mornings it was right.

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import type { AttentionItem } from "@/lib/admin-attention";

function dismissKey(item: AttentionItem) {
  return `admin-action-dismissed:${item.key}`;
}

/** Was this dismissed this visit? Read-only; safe in a state initializer. */
function wasDismissed(item: AttentionItem | null): boolean {
  if (!item || typeof window === "undefined") return true;
  try {
    return sessionStorage.getItem(dismissKey(item)) != null;
  } catch {
    return false;
  }
}

/** True only after hydration, so a render can read browser-only state without
 *  the client's first paint disagreeing with the server's. */
const subscribeNoop = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
}

/**
 * `items` is the whole queue, already ranked. This picks the top one and shows
 * it only if nothing else ties with it.
 */
export function AdminActionSheet({ items }: { items: AttentionItem[] }) {
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(false);

  const top = items[0] ?? null;
  // A tie at the top means "several things need you", which is a list, not a
  // question. The Alerts badge carries that; this stays quiet.
  const alone = !!top && items.filter((i) => i.rank === top.rank).length === 1;
  const item = alone && top.rank === 0 ? top : null;

  const open = hydrated && !dismissed && !!item && !wasDismissed(item);

  if (!item) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(dismissKey(item!), "1");
    } catch {
      /* private mode — fine, it just reopens */
    }
    setDismissed(true);
  }

  return (
    <Sheet open={open} onClose={dismiss} title={item.title}>
      <div className="space-y-4">
        {item.detail && <p className="text-fg-2">{item.detail}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
          <Link href={item.href} onClick={dismiss} className="contents">
            <Button className="w-full">{item.action}</Button>
          </Link>
        </div>
      </div>
    </Sheet>
  );
}
