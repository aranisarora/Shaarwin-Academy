"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { enablePush, type PushState } from "@/lib/push";
import { PREF_TYPES } from "@/lib/notification-prefs";
import { saveNotificationPrefs } from "@/app/app/onboarding/actions";

/**
 * Onboarding step 3: notification toggles (default on) + push opt-in. Push
 * can't be forced — a denied browser permission still completes the step,
 * reminders just go by email instead.
 */
export function NotificationsStep({
  initialPrefs,
  onDone,
}: {
  initialPrefs: Record<string, boolean>;
  onDone: () => void;
}) {
  const [prefs, setPrefs] = useState(initialPrefs);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function finish() {
    setError(null);
    startTransition(async () => {
      const r = await saveNotificationPrefs(prefs);
      if (!r.ok) return setError(r.error ?? "Couldn't save your preferences.");
      onDone();
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2 rounded-[12px] border border-line bg-surface-2 p-4">
        {PREF_TYPES.map(([key, labelText]) => {
          const on = prefs[key] !== false; // default on
          return (
            <label key={key} className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-sm">{labelText}</span>
              <button
                role="switch"
                aria-checked={on}
                onClick={() => setPrefs({ ...prefs, [key]: !on })}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  on ? "bg-ember" : "bg-line"
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-ivory transition-all ${
                    on ? "left-6" : "left-1"
                  }`}
                />
              </button>
            </label>
          );
        })}
        <p className="pt-1 text-xs text-fg-2">
          Payment and cancellation notices always deliver.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={async () => setPushState(await enablePush())}>
          Enable push notifications
        </Button>
        {pushState === "subscribed" && <Badge tone="ok">Push on</Badge>}
        {pushState === "denied" && (
          <p className="text-xs text-fg-2">
            Notifications: email. Re-enable them in your browser&apos;s site settings.
          </p>
        )}
        {pushState === "unsupported" && (
          <p className="text-xs text-fg-2">Notifications: email on this device.</p>
        )}
      </div>

      {error && <p className="text-sm text-err">{error}</p>}
      <Button onClick={finish} disabled={pending} className="w-full" size="lg">
        {pending ? <Spinner /> : "Next"}
      </Button>
    </div>
  );
}
