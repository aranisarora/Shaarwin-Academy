"use client";

import { useCallback, useEffect, useState } from "react";
import { locationState, requestLocation, type LocationState } from "@/lib/location";
import { markDismissed, readDismissed } from "@/lib/permission-prompt";
import {
  LOCATION_DISMISSED_KEY,
  LOCATION_PROMPT_COPY,
  locationPromptFor,
} from "@/lib/location-prompt";
import { PermissionPrompt } from "@/components/app/PermissionPrompt";

/**
 * Ask a coach for location, so the app can mark them as arrived on its own.
 *
 * Mounted in app/coach/layout.tsx only, and behind the push ask (see
 * <PushPrompt thenAsk=… />). Coaches only is a decision, not an oversight:
 * parents and the founder have no arrival to mark, so asking them for location
 * buys nothing and costs the kind of trust that is expensive to get back.
 *
 * The reason this exists at all is that the geofence was never the problem.
 * Auto-arrival has worked since it shipped — it fired once in production, at
 * 42 m, exactly as designed — against 42 arrivals marked by hand, 37 of which
 * recorded no GPS fix whatsoever. Nobody had ever been asked.
 *
 * Same gesture rule as enablePush(): requestLocation() runs from the click and
 * nowhere else. On mount we only *read* the permission — via the Permissions
 * API, which is the one way to find out where we stand without the finding out
 * being the prompt.
 */
export function LocationPrompt() {
  const [state, setState] = useState<LocationState | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    locationState()
      .then((settled) => {
        if (!alive) return;
        setState(settled);
        setDismissed(readDismissed(LOCATION_DISMISSED_KEY));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    markDismissed(LOCATION_DISMISSED_KEY);
    setDismissed(true);
  }, []);

  async function allow() {
    setBusy(true);
    try {
      // This both asks and takes a first fix. The fix is not wasted work: it
      // warms the platform's cache, so the proximity check that runs moments
      // later at the venue often has a position already waiting for it.
      setState(await requestLocation());
      // "granted" and "denied" both end the conversation — locationPromptFor
      // returns show:false for each. Nothing to dismiss: a dismissal comes back
      // next session and a refusal shouldn't.
    } finally {
      setBusy(false);
    }
  }

  // `isCoach` is true by construction — this component is only ever mounted in
  // the coach shell. It stays a parameter of the decision rather than an
  // assumption inside it so the rule is stated somewhere a test can read it.
  const decision = locationPromptFor(state, dismissed, true);
  if (!decision.show) return null;

  return (
    <PermissionPrompt
      id="location-prompt"
      copy={LOCATION_PROMPT_COPY[decision.kind]}
      mode={decision.mode}
      busy={busy}
      onConfirm={allow}
      onDismiss={dismiss}
    />
  );
}
