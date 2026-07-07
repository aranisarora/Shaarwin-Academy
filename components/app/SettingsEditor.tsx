"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { saveSettings } from "@/app/admin/settings/actions";

const LABELS: Record<string, string> = {
  cancellation_window_hours: "Cancellation window (hours)",
  booking_cutoff_minutes: "Booking cutoff (minutes before start)",
  travel_buffer_minutes: "Coach travel buffer (minutes)",
  reschedule_max_hops: "Max reschedules per booking",
  dunning_grace_days: "Dunning grace (days)",
  waitlist_claim_minutes: "Waitlist claim window (minutes)",
};

export function SettingsEditor({ values }: { values: Record<string, number> }) {
  const [state, setState] = useState(values);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {Object.entries(LABELS).map(([key, labelText]) => (
        <Input
          key={key}
          label={labelText}
          type="number"
          value={state[key] ?? ""}
          onChange={(e) =>
            setState((s) => ({ ...s, [key]: Number(e.target.value) }))
          }
        />
      ))}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await saveSettings(state);
            setMessage(r.ok ? "Saved." : (r.error ?? "Save failed."));
          })
        }
      >
        {pending ? <Spinner /> : "Save settings"}
      </Button>
      {message && <p className="text-sm text-fg-2">{message}</p>}
    </div>
  );
}
