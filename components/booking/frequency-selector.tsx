"use client";

import { cn } from "@/lib/utils";

interface FrequencySelectorProps {
  value: "one-time" | "weekly";
  onChange: (value: "one-time" | "weekly") => void;
}

export function FrequencySelector({ value, onChange }: FrequencySelectorProps) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => onChange("one-time")}
        className={cn(
          "flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
          value === "one-time"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-background text-foreground border-input hover:bg-accent"
        )}
      >
        <div className="font-medium">One-time</div>
        <div className="mt-1 text-xs opacity-80">Single session</div>
      </button>
      <button
        type="button"
        onClick={() => onChange("weekly")}
        className={cn(
          "flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
          value === "weekly"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-background text-foreground border-input hover:bg-accent"
        )}
      >
        <div className="font-medium">Weekly</div>
        <div className="mt-1 text-xs opacity-80">Recurring for 4 months</div>
      </button>
    </div>
  );
}
