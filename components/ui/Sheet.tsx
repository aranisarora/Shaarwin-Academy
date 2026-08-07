"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";

/**
 * Bottom sheet on <768px, right side-panel on desktop.
 * Controlled: pass `open` + `onClose`.
 *
 * On a phone this is the most-used surface in the whole admin app, so it earns
 * the four things that separate a native sheet from a div parked at the bottom:
 *
 *   • The grab handle really drags. It used to draw a 40×4 pill that promised a
 *     gesture and implemented none — you could only leave by finding the ✕.
 *     A pull past ~96px or a firm flick dismisses; anything shorter springs back.
 *   • Tab stays inside. Nothing trapped focus, so tabbing walked straight out of
 *     an aria-modal dialog into the page it was covering.
 *   • The page underneath actually stops moving. `body { overflow: hidden }` is
 *     a no-op on iOS Safari; only position:fixed holds, and that loses your
 *     scroll position unless you put it back by hand on the way out.
 *   • The primary action clears the home indicator and the keyboard.
 */

/** How far you have to pull before letting go dismisses rather than springs back. */
const DISMISS_PX = 96;
/** px per ms — the difference between a flick and a slow, considered drag. */
const DISMISS_VELOCITY = 0.5;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  dirty = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  /**
   * There are unsaved edits in here. Every way out — backdrop, ✕, Escape, and
   * the drag — asks once instead of closing.
   *
   * It lives on the Sheet rather than in each caller because the drag is the
   * dangerous one and only this component knows about it: a thumb resting on
   * the title bar of a long sheet, drifting 96px while reading, silently threw
   * away a half-filled form.
   */
  dirty?: boolean;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  // Callers pass inline closures; keep the latest one in a ref so the effect
  // below depends only on `open` — re-running it on every parent render would
  // steal focus from inputs inside the sheet on each keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const dragRef = useRef<{
    id: number;
    startY: number;
    y: number;
    prevY: number;
    prevT: number;
  } | null>(null);
  // A dismiss animation is already running; ignore anything else that asks.
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  // How much of the screen the on-screen keyboard is covering, on iOS.
  const [keyboardInset, setKeyboardInset] = useState(0);
  // Armed by any exit attempt while `dirty`.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Read through a ref so the close handlers below can stay stable.
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });

  /** Every exit goes through here. Returns whether it actually closed. */
  const requestClose = useCallback(() => {
    if (dirtyRef.current) {
      setConfirmDiscard(true);
      return false;
    }
    onCloseRef.current();
    return true;
  }, []);


  useEffect(() => {
    if (!open) return;
    closingRef.current = false;

    // Where the founder was before this opened, so closing puts him back.
    // Nothing restored focus before, and every caller mounts its sheet
    // conditionally — so closing dropped focus onto <body> and a keyboard user
    // started again from the top of the page each time.
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        requestClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (stops.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const here = document.activeElement;
      const inside = here instanceof Node && panel.contains(here);
      if (e.shiftKey ? here === first || !inside : here === last || !inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey);

    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      // A drag that was still flying out when something else closed the sheet
      // must not fire onClose a second time into whatever opened next.
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      // Put focus back where it came from. Guarded on the opener still being in
      // the document: several sheets close by removing the very card that
      // opened them, and focusing a detached node silently does nothing.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, requestClose]);

  // iOS ignores overflow:hidden on <body>; pinning it is the only lock that
  // holds. It also scrolls the page to the top as a side effect, so remember
  // where we were and put it back — a founder who opened a sheet from row 40 of
  // the schedule should land back on row 40.
  //
  // This has to be a layout effect, not a passive one. Several sheets close by
  // navigating ("Open this week's session →"), and React runs the incoming
  // route's layout effects — Next's own scroll-to-top among them — before the
  // passive cleanups of the tree it has just removed. Passively, the order came
  // out backwards: Next asked for the top while the body was still pinned and
  // the document had nothing to scroll, then we unpinned and restored the old
  // offset, and the new page opened 800px down someone else's list. Unpinning in
  // the mutation phase puts us first and leaves Next's scroll the last word.
  useLayoutEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const before = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      Object.assign(body.style, before);
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => {
      // Anything the visual viewport has lost to the keyboard. Android already
      // shrank the layout viewport (interactiveWidget), so this reads ~0 there
      // and the sheet doesn't get lifted twice.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardInset(covered > 40 ? Math.round(covered) : 0);
    };
    measure();
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, [open]);

  /** End of a drag: either see it out of the bottom of the screen, or put it back. */
  const settle = useCallback((dismiss: boolean) => {
    const panel = panelRef.current;
    if (!panel) return;
    const backdrop = backdropRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!dismiss) {
      panel.style.transition = reduced
        ? "none"
        : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";
      panel.style.transform = "translateY(0px)";
      if (backdrop) {
        backdrop.style.transition = reduced ? "none" : "opacity 260ms ease-out";
        backdrop.style.opacity = "1";
      }
      return;
    }
    if (closingRef.current) return;
    closingRef.current = true;
    if (reduced) {
      onCloseRef.current();
      return;
    }
    // Follow the finger out rather than snapping shut — unmounting mid-gesture
    // is the one thing that would give the drag away as fake.
    panel.style.transition = "transform 180ms cubic-bezier(0.32, 0.72, 0, 1)";
    panel.style.transform = `translateY(${panel.offsetHeight}px)`;
    if (backdrop) {
      backdrop.style.transition = "opacity 180ms ease-out";
      backdrop.style.opacity = "0";
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, 170);
  }, []);

  // The panel is moved by writing to the node, not by re-rendering on every
  // pointermove. This is the one interaction that has to hold 60fps.
  function onGrabDown(e: React.PointerEvent<HTMLDivElement>) {
    // Desktop is a side panel pinned top to bottom — there is nothing to pull.
    if (window.matchMedia("(min-width: 768px)").matches) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    dragRef.current = {
      id: e.pointerId,
      startY: e.clientY,
      y: 0,
      prevY: e.clientY,
      prevT: e.timeStamp,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    panel.style.transition = "none";
  }

  function onGrabMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel || e.pointerId !== drag.id) return;
    // Down only. Dragging up must not lift the sheet off the bottom edge.
    drag.y = Math.max(0, e.clientY - drag.startY);
    if (e.timeStamp - drag.prevT > 16) {
      drag.prevY = e.clientY;
      drag.prevT = e.timeStamp;
    }
    panel.style.transform = `translateY(${drag.y}px)`;
    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.style.opacity = String(Math.max(0.35, 1 - drag.y / 420));
    }
  }

  function onGrabUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.id) return;
    dragRef.current = null;
    const elapsed = Math.max(1, e.timeStamp - drag.prevT);
    const velocity = (e.clientY - drag.prevY) / elapsed;
    const wantsDismiss = drag.y > DISMISS_PX || velocity > DISMISS_VELOCITY;
    // Spring back and ask, rather than following the finger out with a form in
    // it. This is the exit that gets taken by accident.
    if (wantsDismiss && dirtyRef.current) {
      settle(false);
      setConfirmDiscard(true);
      return;
    }
    settle(wantsDismiss);
  }

  function onGrabCancel() {
    if (!dragRef.current) return;
    dragRef.current = null;
    settle(false);
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        ref={backdropRef}
        aria-label="Close"
        className="sheet-backdrop absolute inset-0 bg-ink/60"
        onClick={() => requestClose()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={
          keyboardInset
            ? ({ "--kb": `${keyboardInset}px` } as React.CSSProperties)
            : undefined
        }
        className="sheet-panel-bottom sheet-lift absolute inset-x-0 max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-[12px] border-t border-line bg-surface-2 shadow-[var(--shadow-sheet)] md:inset-x-auto md:inset-y-0 md:right-0 md:h-full md:max-h-none md:w-[440px] md:rounded-none md:border-l md:border-t-0"
        data-mood="studio"
      >
        {/* The handle and the title bar are one grab area, because that is where
            a thumb lands. touch-none keeps the panel from scrolling under the
            gesture; the ✕ is excluded in onGrabDown so a tap still closes. */}
        <div
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabCancel}
          className="sticky top-0 z-10 touch-none bg-surface-2 md:touch-auto"
        >
          <div className="flex h-6 cursor-grab items-center justify-center md:hidden">
            <span aria-hidden className="h-1 w-10 rounded-full bg-line" />
          </div>
          {title && (
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-display text-xl">{title}</h2>
              <button
                onClick={() => requestClose()}
                aria-label="Close sheet"
                className="pressable flex h-11 w-11 items-center justify-center rounded-[8px] text-fg-2 hover:text-fg"
              >
                ✕
              </button>
            </div>
          )}
        </div>
        <div className="px-5 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-5 md:pb-5">
          {children}
        </div>

        {/* Pinned to the bottom of the panel, where the thumb already is, and
            only ever on screen because he tried to leave. Gated on `dirty` as
            well as on the attempt, so a save that lands while it is up takes it
            away rather than leaving him a question about nothing. */}
        {confirmDiscard && dirty && (
          <div
            role="alertdialog"
            aria-label="Unsaved changes"
            className="sticky bottom-0 z-20 border-t border-line bg-surface-2 px-5 pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-4 shadow-[var(--shadow-sheet)]"
          >
            <p className="text-sm text-fg-2">
              You&apos;ve changed things here and not saved them yet.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmDiscard(false);
                  onCloseRef.current();
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
