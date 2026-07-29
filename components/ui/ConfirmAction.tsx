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
  fullWidth = true,
}: {
  label: string;
  confirmLabel: string;
  prompt: string;
  onConfirm: () => void;
  pending: boolean;
  /**
   * Trigger style; the confirm button is always destructive. "subtle" is the
   * underlined text link used for an action that should be hard to hit by
   * accident (deleting a class outright, as opposed to ending it).
   */
  variant?: "destructive" | "ghost" | "subtle";
  keepLabel?: string;
  /** False lets the trigger sit inline beside other buttons in a row. */
  fullWidth?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    if (variant === "subtle") {
      return (
        <button
          disabled={pending}
          className={`text-center text-sm text-fg-2 underline-offset-4 hover:underline ${
            fullWidth ? "w-full" : ""
          }`}
          onClick={() => setArmed(true)}
        >
          {label}
        </button>
      );
    }
    return (
      <Button
        variant={variant}
        className={fullWidth ? "w-full" : ""}
        disabled={pending}
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-[8px] border border-line p-3">
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
