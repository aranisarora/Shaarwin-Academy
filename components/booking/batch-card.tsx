"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Check, Users } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import { DAY_CODES } from "@/lib/constants";
import type { Batch } from "@/types/database";

interface BatchCardProps {
  batch: Batch;
  bookingCount: number;
  selected: boolean;
  booked?: boolean;
  onToggle: (batch: Batch) => void;
}

export function BatchCard({
  batch,
  bookingCount,
  selected,
  booked,
  onToggle,
}: BatchCardProps) {
  const isFull = bookingCount >= batch.max_capacity;
  const isDisabled = isFull || !!booked;

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
          isDisabled && "opacity-60 cursor-not-allowed",
          !isDisabled && "cursor-pointer hover:shadow-md",
          selected && "ring-2 ring-primary border-primary"
        )}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {selected && (
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
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
          </div>

          {/* Capacity / booked indicator */}
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
