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
  /** False lets the trigger — and the armed box behind it — sit inline beside
   *  other buttons in a row rather than claim the whole width. */
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
  // The armed box used to hardcode `w-full`, which read as harmless until you
  // remember what its *intrinsic* width is: a whole sentence of prompt on one
  // line, near 600px. Inside a row that doesn't let it shrink, that width is
  // what the row asks for, and the row wins — the controls hang off the side of
  // the card, worst on the phone. So it honours fullWidth like the trigger
  // does, refuses to claim more than its container, and lets the two buttons
  // wrap onto separate lines rather than squeeze their labels.
  return (
    <div
      className={`min-w-0 max-w-full space-y-2 rounded-[8px] border border-line p-3 ${
        fullWidth ? "w-full" : ""
      }`}
    >
      <p className="text-sm text-fg-2">{prompt}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          className="min-w-fit flex-1 basis-32"
          disabled={pending}
          onClick={() => setArmed(false)}
        >
          {keepLabel}
        </Button>
        <Button
          variant="destructive"
          className="min-w-fit flex-1 basis-32"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? <Spinner /> : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
