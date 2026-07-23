"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import {
  getPendingAssessments,
  type PendingAssessment,
} from "@/app/coach/assess-actions";

/**
 * Blocking prompt that cycles a coach through players still owed an assessment
 * (attended, session ended in the last 7 days). Self-fetches on every pathname
 * change so it stays fresh across client navigations (layouts don't re-render).
 * No dismiss — it disappears only when the queue is empty. Hidden while the
 * coach is on the very player page it points to, so it never blocks that form.
 */
export function PendingAssessments() {
  const pathname = usePathname();
  const [items, setItems] = useState<PendingAssessment[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;
    getPendingAssessments().then((list) => {
      if (active) {
        setItems(list);
        setIndex(0);
      }
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  if (items.length === 0) return null;

  const current = items[index % items.length];
  if (pathname === `/coach/players/${current.playerId}`) return null;

  return (
    <div className="pb-safe fixed inset-x-3 bottom-16 z-50 rounded-[12px] border border-ember bg-surface-2 p-4 shadow-[var(--shadow-sheet)] lg:bottom-6 lg:left-auto lg:right-6 lg:w-96">
      <p className="font-medium">Pending assessments ({items.length})</p>
      <p className="mt-1 text-sm text-fg-2">
        Complete assessment for <strong>{current.playerName}</strong> —{" "}
        {current.classTitle}
      </p>
      <div className="mt-3 flex gap-2">
        <ButtonLink href={`/coach/players/${current.playerId}?session=${current.sessionId}`}>
          Assess now
        </ButtonLink>
        {items.length > 1 && (
          <Button variant="ghost" onClick={() => setIndex((i) => (i + 1) % items.length)}>
            Next player
          </Button>
        )}
      </div>
    </div>
  );
}
