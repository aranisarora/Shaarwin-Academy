"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { locationState, requestLocation, type LocationState } from "@/lib/location";
import { LOCATION_STATE_COPY } from "@/lib/location-prompt";

/**
 * Where location stands for this coach, on the screen they already open to
 * change anything about themselves — beside <PushToggle />, and for the same
 * reason it exists.
 *
 * The prompt (<LocationPrompt />) deliberately says nothing in three of the four
 * states, because a dialog whose button cannot finish the job is worse than
 * silence. `denied` is the one that needs somewhere to live: a coach who refused
 * once is never asked again, auto-arrival silently never works for them, and
 * without this card there is nothing anywhere that says why or what to do. A
 * settings surface can afford to describe a state it cannot fix; an interruption
 * cannot.
 *
 * The copy is shared with the prompt through LOCATION_STATE_COPY, the same
 * arrangement PushToggle has with PUSH_STATE_COPY — two surfaces describing one
 * phone must not drift into telling a coach two different stories about it.
 */
export function LocationToggle({ className = "" }: { className?: string }) {
  const [state, setState] = useState<LocationState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // A read, never a request. Calling getCurrentPosition to find out where we
    // stand *is* the permission prompt, and firing one on a settings screen the
    // coach opened to edit their bio is exactly the interruption this app is
    // trying to stop being.
    locationState()
      .then((settled) => {
        if (alive) setState(settled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function allow() {
    setBusy(true);
    try {
      setState(await requestLocation());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-[12px] border border-line bg-surface-2 p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <p className="label">Automatic arrival</p>
        {state === "granted" && <Badge tone="ok">On</Badge>}
      </div>
      <p className="mt-1 text-sm text-fg-2">
        {state ? LOCATION_STATE_COPY[state] : "Checking this device…"}
      </p>

      {/* Only "prompt" has a button, and it is the browser's own dialog behind
          it. There is no "turn off": the permission belongs to the browser, and
          a switch here that only stopped *us* asking would tell a coach they had
          revoked something they hadn't. `denied` says where the real switch is
          instead — mirroring PushToggle, which also sends denied to site
          settings rather than pretending to own it. */}
      {state === "prompt" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="ghost" disabled={busy} onClick={allow}>
            {busy ? <Spinner /> : "Allow location"}
          </Button>
        </div>
      )}
    </div>
  );
}
