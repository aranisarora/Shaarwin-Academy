"use client";

// Press and hold to start picking things.
//
// This is the one gesture the admin screens lean on, so it lives in one place
// rather than being re-derived per surface. The rules it encodes are the ones
// that make a hold feel native rather than like a slow tap:
//
//   • Touch only. A mouse gets the "Select" button — long-pressing with a mouse
//     is a gesture nobody performs, and binding it there would only mean a
//     founder who rests the pointer on a card while reading gets thrown into
//     selection mode.
//   • Moving cancels. A hold that drifts more than SLOP_PX is the start of a
//     scroll, and a list of cards is a thing you scroll far more often than you
//     select from. Getting this wrong is what makes a long-press feel like it
//     "fires randomly while I'm reading".
//   • The click that follows is swallowed. The browser still delivers a click on
//     release, and without `consumeClick` a hold would select the card AND open
//     its sheet — one gesture, two outcomes, the second one on top.
//   • A short buzz on fire, where the hardware allows. It is the only signal the
//     founder gets before he lifts his finger; without it a hold feels like
//     nothing happened until the ticks appear.

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";

/** Long enough not to fire on a normal tap, short enough not to feel stuck. */
const HOLD_MS = 450;
/** Past this much drift the gesture is a scroll, not a hold. */
const SLOP_PX = 10;

export function useLongPress(onLongPress?: (() => void) | null, holdMs = HOLD_MS) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  // A card can unmount mid-hold (a filter change, a refresh landing), and a
  // timer that outlives it would call back into a dead tree.
  useEffect(() => cancel, [cancel]);

  const handlers = onLongPress
    ? {
        onPointerDown(e: ReactPointerEvent) {
          if (e.pointerType === "mouse") return;
          fired.current = false;
          origin.current = { x: e.clientX, y: e.clientY };
          timer.current = window.setTimeout(() => {
            timer.current = null;
            fired.current = true;
            if (typeof navigator !== "undefined" && "vibrate" in navigator) {
              navigator.vibrate?.(15);
            }
            onLongPress();
          }, holdMs);
        },
        onPointerMove(e: ReactPointerEvent) {
          const o = origin.current;
          if (!o) return;
          if (Math.abs(e.clientX - o.x) > SLOP_PX || Math.abs(e.clientY - o.y) > SLOP_PX) {
            cancel();
          }
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        // Android fires the context menu on the same hold. Without this the
        // founder gets "open in new tab" over the top of his own selection.
        onContextMenu(e: ReactMouseEvent) {
          if (fired.current) e.preventDefault();
        },
      }
    : {};

  /** True exactly once after a hold fires — the release click belongs to the
   * gesture, not to the card, so the caller returns early instead of opening. */
  const consumeClick = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return { handlers, consumeClick };
}
