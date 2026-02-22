"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Check, Users, Lock } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import { DAY_CODES } from "@/lib/constants";
import type { Batch } from "@/types/database";

interface BatchCardProps {
  batch: Batch;
  bookingCount: number;
  selected: boolean;
  booked?: boolean;
  /** When true the card is non-interactive (e.g. during payment step) */
  locked?: boolean;
  onToggle: (batch: Batch) => void;
}

export function BatchCard({
  batch,
  bookingCount,
  selected,
  booked,
  locked,
  onToggle,
}: BatchCardProps) {
  const isFull = bookingCount >= batch.max_capacity;
  const isDisabled = isFull || !!booked || !!locked;

  const dayNames = batch.day_codes
    .map((code) => DAY_CODES[code] || code)
    .join(", ");

  return (
    <button
      type="button"
      onClick={() => !isDisabled && onToggle(batch)}
      disabled={isDisabled}
      className="w-full text-left"
    >
      <Card
        className={cn(
          "transition-all",
          isDisabled && !locked && "opacity-60 cursor-not-allowed",
          locked && "opacity-50 cursor-default",
          !isDisabled && "cursor-pointer hover:shadow-md",
          selected && !locked && "ring-2 ring-primary border-primary",
          selected && locked && "ring-2 ring-primary/40 border-primary/40"
        )}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {selected && (
                  <div
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      locked ? "bg-primary/40" : "bg-primary"
                    )}
                  >
                    <Check className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
                <h3 className="font-semibold text-base truncate">
                  {batch.title}
                </h3>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Every {dayNames} at {formatTime(batch.start_time)} &ndash;{" "}
                {formatTime(batch.end_time)}
              </p>
            </div>
            {locked && selected && (
              <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            )}
          </div>

          <div className="mt-3 flex items-center gap-1.5">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span
              className={cn(
                "text-sm font-medium",
                isDisabled && "text-muted-foreground"
              )}
            >
              {booked
                ? "Booked"
                : `${bookingCount}/${batch.max_capacity}${isFull ? " Full" : ""}`}
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
