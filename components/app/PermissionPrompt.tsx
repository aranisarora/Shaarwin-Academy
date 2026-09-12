"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import type { PromptCopy, PromptMode } from "@/lib/permission-prompt";

/**
 * How a permission gets asked for — the presentation only, with no idea which
 * permission it is.
 *
 * PR #24 built this inside PushPrompt for push, and it was lifted out here when
 * location became the second ask — a second copy of a focus trap and a card
 * layout is how two prompts end up behaving differently on the same phone. The
 * location ask has since gone (its geofence with it), so push is the only
 * caller today; the split is kept because the next permission inherits it. What
 * each permission keeps for itself is the part with judgement in it: which
 * states are worth asking about, and what the words are (lib/push-prompt.ts).
 *
 * `mode` is the whole of the escalation story: the first ask in a browsing
 * session is a real dialog, and after a dismissal it steps back to the card
 * idiom InstallPrompt already uses for the rest of that session.
 */
export function PermissionPrompt({
  id,
  copy,
  mode,
  busy = false,
  onConfirm,
  onDismiss,
}: {
  /** Slug for the dialog's aria ids — two prompts must not share them. */
  id: string;
  copy: PromptCopy;
  mode: PromptMode;
  busy?: boolean;
  /** Runs from the click, which is the only place a browser will honour it. */
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const actions = (
    <>
      {copy.confirm && (
        <Button loading={busy} onClick={onConfirm}>
          {copy.confirm}
        </Button>
      )}
      <Button variant="ghost" disabled={busy} onClick={onDismiss}>
        {copy.dismiss}
      </Button>
    </>
  );

  if (mode === "card") {
    return (
      // Same slot and idiom as InstallPrompt: `above-tabbar` rather than a
      // hand-computed bottom offset, which went behind the tab bar the moment
      // viewport-fit=cover made it 90px tall.
      <div className="above-tabbar fixed inset-x-3 z-40 rounded-[12px] border border-line bg-surface-2 p-4 shadow-[var(--shadow-sheet)] lg:left-auto lg:right-6 lg:w-96">
        <p className="font-medium">{copy.title}</p>
        <p className="mt-1 text-sm text-fg-2">{copy.body}</p>
        <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
      </div>
    );
  }

  return (
    <PromptModal id={id} title={copy.title} body={copy.body} onClose={onDismiss} actions={actions} />
  );
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * A centred dialog, deliberately smaller than components/ui/Sheet.
 *
 * Sheet is the right thing for editing — it drags, it pins the body, it guards
 * unsaved work. This asks one question with two buttons, and inheriting a
 * drag-to-dismiss gesture for it would mean a thumb resting on the panel could
 * throw the ask away without reading it. What it does keep from Sheet is the
 * part that isn't decoration: a real dialog role, focus that starts inside and
 * stays inside, Escape, and focus returned to wherever it came from.
 */
function PromptModal({
  id,
  title,
  body,
  actions,
  onClose,
}: {
  id: string;
  title: string;
  body: string;
  actions: React.ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
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
      // Guarded on the opener still being in the document — focusing a detached
      // node silently does nothing, and this dialog can outlive a re-render of
      // whatever was focused behind it.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-ink/60"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        tabIndex={-1}
        data-mood="studio"
        className="relative w-full max-w-sm rounded-[12px] border border-line bg-surface-2 p-6 shadow-[var(--shadow-sheet)]"
      >
        <h2 id={`${id}-title`} className="font-display text-xl">
          {title}
        </h2>
        <p id={`${id}-body`} className="mt-2 text-sm text-fg-2">
          {body}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">{actions}</div>
      </div>
    </div>,
    document.body
  );
}
