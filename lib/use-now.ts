"use client";

import { useEffect, useState } from "react";
import { nowMs } from "@/lib/academy-time";

/**
 * A clock that ticks, for UI gated on the time.
 *
 * Components that computed `nowMs()` inline read the clock exactly once — at
 * render — and then never again, because nothing tells React the time has
 * moved. The attendance roster did this: a coach who opened the session screen
 * twenty minutes early saw the Present/Absent buttons greyed out, and they
 * stayed greyed out through the start of the class and on into it, because the
 * only thing that could re-evaluate the window was a manual refresh nobody
 * thinks to do while a hall fills up with children.
 *
 * Thirty seconds is deliberately coarse. The windows this gates are measured in
 * quarter-hours, a tick costs a re-render of one component, and this runs on
 * phones that are also the coach's stopwatch.
 *
 * The initial value comes from the same `nowMs()` the server used, so the first
 * client render matches the markup it is hydrating; only the tick after mount
 * can change what is on screen.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => nowMs());

  useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), intervalMs);

    // A PWA that has been in the background has not been ticking. Coming back
    // to it should show the current state immediately rather than up to
    // `intervalMs` of staleness — that gap is exactly when a coach reopens the
    // app to mark a class that has just started.
    const onVisible = () => {
      if (!document.hidden) setNow(nowMs());
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return now;
}
