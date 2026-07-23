"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { saveSettings } from "@/app/admin/settings/actions";

// Plain-English label + a one-line "what this does" hint for each setting, so
// the founder can tell what he's changing without a manual.
const FIELDS: { key: string; label: string; hint: string }[] = [
  {
    key: "cancellation_window_hours",
    label: "Free cancellation window (hours)",
    hint: "Clients can cancel for free up to this many hours before a class starts.",
  },
  {
    key: "booking_cutoff_minutes",
    label: "Booking cutoff (minutes)",
    hint: "Clients can't book a class that starts within this many minutes.",
  },
  {
    key: "travel_buffer_minutes",
    label: "Coach travel buffer (minutes)",
    hint: "Gap kept between a coach's classes so they have time to travel.",
  },
  {
    key: "reschedule_max_hops",
    label: "Reschedules allowed per booking",
    hint: "How many times a single booking can be moved before it's locked in.",
  },
  {
    key: "dunning_grace_days",
    label: "Days to fix a failed payment",
    hint: "How long a client keeps access after a payment fails, before it's paused.",
  },
  {
    key: "waitlist_claim_minutes",
    label: "Waitlist claim window (minutes)",
    hint: "When a spot opens up, how long the next person has to grab it.",
  },
];

export function SettingsEditor({ values }: { values: Record<string, number> }) {
  const [state, setState] = useState(values);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {FIELDS.map(({ key, label, hint }) => (
        <Input
          key={key}
          label={label}
          hint={hint}
          type="number"
          value={state[key] ?? ""}
          onChange={(e) => {
            setSaved(false);
            setState((s) => ({ ...s, [key]: Number(e.target.value) }));
          }}
        />
      ))}
      <div className="flex items-center gap-3">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await saveSettings(state);
              if (r.ok) {
                setSaved(true);
                setMessage(null);
              } else setMessage(r.error ?? "Save failed.");
            })
          }
        >
          {pending ? <Spinner /> : "Save settings"}
        </Button>
        {saved && !pending && <span className="text-sm text-ok">Saved ✓</span>}
      </div>
      {message && <p className="text-sm text-err">{message}</p>}
    </div>
  );
}
