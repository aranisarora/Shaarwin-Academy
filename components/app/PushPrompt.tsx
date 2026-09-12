"use client";

import { useCallback, useEffect, useState } from "react";
import { enablePush, pushState, type PushState } from "@/lib/push";
import { isClaiming, markDismissed, readDismissed } from "@/lib/permission-prompt";
import { PROMPT_COPY, PUSH_DISMISSED_KEY, pushPromptFor } from "@/lib/push-prompt";
import { PermissionPrompt } from "@/components/app/PermissionPrompt";

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
 * browser. The modal and card themselves are <PermissionPrompt />, which was
 * built shared when location was the second ask; push is the only permission
 * this app requests now, and the shell stays for the next one.
 *
 * Two things here are load-bearing and easy to lose in a refactor:
 *
 *   • enablePush() runs from the click handler and nowhere else. The browser
 *     permission prompt requires a user gesture — called on mount it is either
 *     ignored or, worse, spends the one permission ask the origin ever gets on
 *     a person who wasn't looking at the screen.
 *   • The dismissal is sessionStorage, not localStorage. It is meant to expire.
 */
export function PushPrompt({ thenAsk = null }: { thenAsk?: React.ReactNode }) {
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
        setDismissed(readDismissed(PUSH_DISMISSED_KEY));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    markDismissed(PUSH_DISMISSED_KEY);
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

  // Still reading the device. Nothing renders, and in particular `thenAsk` does
  // not — a queued prompt must not slip in front of a push ask that is a
  // millisecond from appearing.
  if (state === null) return null;

  const decision = pushPromptFor(state, dismissed);

  /**
   * Push isn't asking, so whatever is queued behind it may.
   *
   * This is the whole of the queue, and it is composition rather than
   * arbitration on purpose: two permission dialogs must never be on screen
   * together, and the sequence that reads as one conversation is push first —
   * turn notifications on, then be told what they will be about.
   *
   * A dismissed push prompt is still asking (as a card), so it still holds the
   * slot: following a "Not now" immediately with a different dialog is exactly
   * what teaches people to dismiss the next one unread. The flip side, worth
   * knowing rather than hiding, is that a coach who dismisses push every session
   * is never asked for location — the strict queue chosen over interrupting
   * twice.
   *
   * Enabling push, by contrast, hands the slot over immediately: the state
   * becomes "subscribed", this returns show:false, and the location ask appears
   * in the same session.
   */
  if (!isClaiming(decision)) return <>{thenAsk}</>;

  return (
    <PermissionPrompt
      id="push-prompt"
      copy={PROMPT_COPY[decision.kind]}
      mode={decision.mode}
      busy={busy}
      onConfirm={turnOn}
      onDismiss={dismiss}
    />
  );
}
