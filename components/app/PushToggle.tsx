"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { disablePush, enablePush, pushState, refreshPush, type PushState } from "@/lib/push";

/**
 * The one place anyone turns push on or off — clients on /app/profile, coaches
 * on /coach/more, the founder on /admin/settings.
 *
 * It used to live inline in ProfileEditor, which renders only on the client
 * app, so the two roles that generate most of what we send — coaches running
 * classes and the founder being escalated to — had no way to subscribe at all.
 * The service worker was already registered in all three shells; only the
 * button was missing.
 *
 * The copy is the point of the component. Every state below is a different
 * problem with a different fix, and the old UI collapsed all of them into
 * "Notifications: email on this device." — which reads as a settled decision
 * rather than the several separate, fixable things it actually was.
 */

const COPY: Record<PushState, string> = {
  subscribed: "This device buzzes the moment something needs you.",
  off: "Get a buzz on this device the moment something needs you. Anything urgent still reaches you on WhatsApp either way.",
  denied:
    "Your browser is blocking notifications for Sharwin. Switch them back on in its site settings, then tap again.",
  not_configured:
    "Push isn't switched on for the academy yet. WhatsApp and email carry everything in the meantime.",
  signed_out: "We couldn't tell who you are. Sign in again and turn this back on.",
  save_failed:
    "This device is ready, but we couldn't save it on our side — so nothing would reach you yet. Tap to try again.",
  needs_install:
    "On iPhone and iPad, notifications only work once Sharwin is on your Home Screen. Tap Share, then “Add to Home Screen”, and open it from there.",
  unsupported: "This browser can't show notifications. WhatsApp and email still reach you.",
};

export function PushToggle({
  feedHref,
  className = "",
}: {
  /** The in-app list a notification deep-links into, for this role. */
  feedHref?: string;
  className?: string;
}) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // Two passes on purpose. The first is a local read, so the card paints
    // straight away; the second re-subscribes anyone who already said yes,
    // which repairs a rotated endpoint or a row lost server-side without ever
    // showing a permission prompt.
    pushState()
      .then((first) => {
        if (alive) setState(first);
        return refreshPush();
      })
      .then((settled) => {
        if (alive) setState(settled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function run(fn: () => Promise<PushState>) {
    setBusy(true);
    try {
      setState(await fn());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-[12px] border border-line bg-surface-2 p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <p className="label">Notifications on this device</p>
        {state === "subscribed" && <Badge tone="ok">On</Badge>}
      </div>
      <p className="mt-1 text-sm text-fg-2">{state ? COPY[state] : "Checking this device…"}</p>

      {/* Every state that has something the person can actually do gets a
          button. save_failed belongs here as much as denied does: the fix for a
          write that didn't land is to write it again, and a card that only
          explains the problem is a dead end. */}
      {(state === "off" ||
        state === "denied" ||
        state === "save_failed" ||
        state === "subscribed") && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {state === "subscribed" ? (
            <Button variant="ghost" disabled={busy} onClick={() => run(disablePush)}>
              {busy ? <Spinner /> : "Turn off"}
            </Button>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => run(enablePush)}>
              {busy ? <Spinner /> : state === "off" ? "Turn on notifications" : "Try again"}
            </Button>
          )}
        </div>
      )}

      {feedHref && (
        <Link
          href={feedHref}
          className="mt-3 inline-block text-sm text-fg-2 transition-colors hover:text-ember"
        >
          Everything we&apos;ve sent you →
        </Link>
      )}
    </div>
  );
}
