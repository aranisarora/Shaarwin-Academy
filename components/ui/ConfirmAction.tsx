"use client";

// A destructive action that confirms in two taps inside the sheet — native
// window.confirm dialogs look broken in a PWA and truncate copy on small
// screens. First tap arms it (prompt + Keep/confirm); "Keep" backs out, the
// confirm button runs the action. Shared by the admin, coach and client sheets.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export function ConfirmAction({
  label,
  confirmLabel,
  prompt,
  onConfirm,
  pending,
  variant = "destructive",
  keepLabel = "Keep",
}: {
  label: string;
  confirmLabel: string;
  prompt: string;
  onConfirm: () => void;
  pending: boolean;
  /** Trigger button style; the confirm button is always destructive. */
  variant?: "destructive" | "ghost";
  keepLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button
        variant={variant}
        className="w-full"
        disabled={pending}
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-[8px] border border-line p-3">
      <p className="text-sm text-fg-2">{prompt}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" disabled={pending} onClick={() => setArmed(false)}>
          {keepLabel}
        </Button>
        <Button variant="destructive" disabled={pending} onClick={onConfirm}>
          {pending ? <Spinner /> : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
