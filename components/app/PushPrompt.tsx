"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { enablePush, pushState, type PushState } from "@/lib/push";
import { PROMPT_COPY, pushPromptFor } from "@/lib/push-prompt";

/**
 * The ask. Mounted in the three signed-in shells beside <InstallPrompt />.
 *
 * Push had exactly one subscriber against 75 profiles, and the reason was never
 * refusal: NEXT_PUBLIC_VAPID_PUBLIC_KEY only reached production on 2026-08-06,
 * and the only switch since has been a card on a settings page. So the first
 * ask in a session is a real dialog rather than another card — an ignorable
 * surface is precisely what produced 1-of-75, and repeating it would be doing
 * the same thing again more loudly.
 *
 * Which states are worth asking about, and why the rest are silent, is
 * pushPromptFor() in lib/push-prompt.ts, where it can be tested without a
 * browser.
 *
 * Two things here are load-bearing and easy to lose in a refactor:
 *
 *   • enablePush() runs from the click handler and nowhere else. The browser
 *     permission prompt requires a user gesture — called on mount it is either
 *     ignored or, worse, spends the one permission ask the origin ever gets on
 *     a person who wasn't looking at the screen.
 *   • The dismissal is sessionStorage, not localStorage. It is meant to expire.
 */
const DISMISSED_KEY = "sharwin:push-prompt-dismissed";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    // Private mode with storage blocked. Worst case the modal is the only shape
    // this session ever shows, which is the safe direction to fail.
    return false;
  }
}

export function PushPrompt() {
  const [state, setState] = useState<PushState | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // pushState() never prompts and never subscribes — it only reads what this
    // device already is. The prompt is the only thing here that asks for
    // anything, and only when tapped.
    pushState()
      .then((settled) => {
        if (!alive) return;
        setState(settled);
        setDismissed(readDismissed());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to do — the card below is still reachable this render, and the
      // next load simply asks again.
    }
    setDismissed(true);
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const settled = await enablePush();
      setState(settled);
      // "subscribed" and "denied" both end the conversation — pushPromptFor
      // returns show:false for each — so there is nothing to dismiss. A
      // dismissed prompt would come back next session; a denied one shouldn't.
    } finally {
      setBusy(false);
    }
  }

  const decision = pushPromptFor(state, dismissed);
  if (!decision.show) return null;

  const copy = PROMPT_COPY[decision.kind];
  const actions = (
    <>
      {copy.confirm && (
        <Button loading={busy} onClick={turnOn}>
          {copy.confirm}
        </Button>
      )}
      <Button variant="ghost" disabled={busy} onClick={dismiss}>
        {copy.dismiss}
      </Button>
    </>
  );

  if (decision.mode === "card") {
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

  return <PromptModal title={copy.title} body={copy.body} onClose={dismiss} actions={actions} />;
}

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
  title,
  body,
  actions,
  onClose,
}: {
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
        aria-labelledby="push-prompt-title"
        aria-describedby="push-prompt-body"
        tabIndex={-1}
        data-mood="studio"
        className="relative w-full max-w-sm rounded-[12px] border border-line bg-surface-2 p-6 shadow-[var(--shadow-sheet)]"
      >
        <h2 id="push-prompt-title" className="font-display text-xl">
          {title}
        </h2>
        <p id="push-prompt-body" className="mt-2 text-sm text-fg-2">
          {body}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">{actions}</div>
      </div>
    </div>,
    document.body
  );
}
