"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { AssessmentSheet } from "@/components/app/AssessmentSheet";
import { getWrapUpQueue, type WrapUpItem } from "@/app/coach/assess-actions";
import { formatDayLong } from "@/lib/academy-time";
import { useNow } from "@/lib/use-now";

/**
 * The one thing still owed on a class that has ended, and a way to do it here.
 *
 * Replaces PendingAssessments, which had three problems a busy coach felt:
 *
 *   • It could not see half the job. Its queue came from
 *     `get_pending_assessments`, which only counts players already marked
 *     ATTENDED — so a class whose roster was never touched had no attended
 *     bookings, contributed nothing, and the prompt went silent about precisely
 *     the class that had been skipped. Unmarked attendance is also what hides
 *     the assessments behind it, so the backlog it was chasing could not even
 *     be reached. It now reads `get_coach_wrapup_queue`, which returns both and
 *     sorts attendance first.
 *   • Every job cost a navigation. "Assess now" left for /coach/players/[id];
 *     the assessment for a player is now filed from a sheet over this card.
 *   • It re-fetched over the network on EVERY pathname change, because it keyed
 *     its effect on `pathname` to stay fresh across client navigations. Walking
 *     three screens cost three round trips to recompute a list that changes
 *     when the coach does something, not when they browse.
 *
 * No permanent dismiss — it goes when the queue is empty, which is the point.
 * "Later" is a thirty-minute snooze held in sessionStorage, so it returns within
 * the session and always returns on the next launch. A coach mid-class who
 * cannot deal with this right now needs somewhere to put it that is not "ignore
 * a card forever".
 */

const SNOOZE_MS = 30 * 60_000;
const SNOOZE_KEY = "wrapup-snooze-until";
/** Don't re-ask the server for the queue more often than this while browsing. */
const REFETCH_AFTER_MS = 60_000;

export function CoachWrapUpPrompt() {
  const pathname = usePathname();
  const [items, setItems] = useState<WrapUpItem[]>([]);
  const [index, setIndex] = useState(0);
  const [rating, setRating] = useState<{ playerId: string; name: string; sessionId: string } | null>(
    null
  );
  // Read straight out of sessionStorage at mount rather than restored by an
  // effect. There is no hydration risk: `items` is empty until the queue
  // resolves, so both server and client render nothing on the first pass and
  // this value cannot change what the markup says.
  const [snoozedUntil, setSnoozedUntil] = useState(() =>
    typeof window === "undefined" ? 0 : Number(sessionStorage.getItem(SNOOZE_KEY) ?? 0)
  );
  const fetchedAt = useRef(0);

  // A ticking clock, so a snooze expiring brings the card back on its own
  // rather than on the coach's next navigation — and so nothing reads the
  // wall clock during render.
  const now = useNow();

  const load = useCallback(() => {
    fetchedAt.current = Date.now();
    getWrapUpQueue().then((list) => {
      setItems(list);
      setIndex((i) => (i < list.length ? i : 0));
    });
  }, []);

  useEffect(() => {
    // Layouts don't re-render across client navigations, so this component has
    // to notice route changes itself — but it only needs to ASK again if the
    // list it holds has gone stale, not on every hop.
    if (Date.now() - fetchedAt.current < REFETCH_AFTER_MS) return;
    load();
  }, [pathname, load]);

  // Coming back to a backgrounded PWA is the moment the queue is most likely to
  // have changed underneath — a WhatsApp "All present" tap, or another device.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      if (Date.now() - fetchedAt.current < REFETCH_AFTER_MS) return;
      load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  function snooze() {
    const until = Date.now() + SNOOZE_MS;
    sessionStorage.setItem(SNOOZE_KEY, String(until));
    setSnoozedUntil(until);
  }

  /** Drop a finished job locally so the queue advances without a round trip. */
  function complete(done: WrapUpItem) {
    setItems((list) =>
      list.filter((it) =>
        it.kind === "assessment" && done.kind === "assessment"
          ? !(it.playerId === done.playerId && it.sessionId === done.sessionId)
          : it !== done
      )
    );
    setIndex(0);
  }

  if (items.length === 0) return null;
  if (now < snoozedUntil) return null;

  const current = items[index % items.length];

  // Never sit on top of the screen that does this very job — the session page
  // for an attendance item, the player page for an assessment.
  const ownScreen =
    current.kind === "attendance"
      ? `/coach/session/${current.sessionId}`
      : `/coach/players/${current.playerId}`;
  if (pathname === ownScreen) return null;

  const when = formatDayLong(current.endedAt);

  return (
    <>
      {/* Same offset as the FAB and the bulk-action bars — see `.above-tabbar`. */}
      <div className="above-tabbar fixed inset-x-3 z-50 rounded-[12px] border border-ember bg-surface-2 p-4 shadow-[var(--shadow-sheet)] lg:left-auto lg:right-6 lg:w-96">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-medium">
            {items.length === 1 ? "One thing to finish" : `${items.length} things to finish`}
          </p>
          {items.length > 1 && (
            <p className="tnum shrink-0 text-xs text-fg-2">
              {(index % items.length) + 1} of {items.length}
            </p>
          )}
        </div>

        {current.kind === "attendance" ? (
          <p className="mt-1 text-sm text-fg-2">
            Mark who came to <strong className="text-fg">{current.classTitle}</strong> —{" "}
            {current.pendingCount}{" "}
            {current.pendingCount === 1 ? "player is" : "players are"} still unmarked. {when}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-fg-2">
            Rate <strong className="text-fg">{current.playerName}</strong> for{" "}
            {current.classTitle}. {when}.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {current.kind === "attendance" ? (
            // Attendance needs the roster, so this is the one job that still
            // travels — but it lands on the screen already scrolled to the list,
            // and `?wrap=1` carries it on into the assessments afterwards.
            <ButtonLink href={`/coach/session/${current.sessionId}?wrap=1`}>
              Mark attendance
            </ButtonLink>
          ) : (
            <Button
              onClick={() =>
                setRating({
                  playerId: current.playerId,
                  name: current.playerName,
                  sessionId: current.sessionId,
                })
              }
            >
              Rate now
            </Button>
          )}

          {items.length > 1 && (
            <Button variant="ghost" onClick={() => setIndex((i) => (i + 1) % items.length)}>
              Next
            </Button>
          )}

          <Button variant="ghost" onClick={snooze}>
            Later
          </Button>
        </div>
      </div>

      {rating && (
        <AssessmentSheet
          key={rating.playerId}
          open
          onClose={() => setRating(null)}
          playerId={rating.playerId}
          playerName={rating.name}
          sessionId={rating.sessionId}
          classTitle={current.classTitle}
          onSaved={() => {
            complete(current);
            setRating(null);
          }}
        />
      )}
    </>
  );
}
