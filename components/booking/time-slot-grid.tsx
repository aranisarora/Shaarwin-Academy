"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn, formatTime } from "@/lib/utils";
import { DAY_NAMES } from "@/lib/constants";
import { OPERATING_HOURS } from "@/config/operating-hours";

export interface TimeSlot {
  day: string;
  startTime: string;
}

interface TimeSlotGridProps {
  selectedSlots: TimeSlot[];
  onChange: (slots: TimeSlot[]) => void;
}

const DAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function addOneHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function generateSlots(dayIndex: number): string[] {
  const hours = OPERATING_HOURS[dayIndex];
  if (!hours) return [];

  const [openH, openM] = hours.open.split(":").map(Number);
  const [closeH, closeM] = hours.close.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  const slots: string[] = [];
  let current = openMinutes;

  while (current + 60 <= closeMinutes) {
    const h = Math.floor(current / 60);
    const m = current % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    current += 30;
  }

  return slots;
}

export function TimeSlotGrid({ selectedSlots, onChange }: TimeSlotGridProps) {
  const [activeDay, setActiveDay] = useState<string | null>(null);

  const isSlotSelected = (day: string, startTime: string) =>
    selectedSlots.some((s) => s.day === day && s.startTime === startTime);

  const toggleSlot = (day: string, startTime: string) => {
    if (isSlotSelected(day, startTime)) {
      onChange(
        selectedSlots.filter(
          (s) => !(s.day === day && s.startTime === startTime)
        )
      );
    } else {
      onChange([...selectedSlots, { day, startTime }]);
    }
  };

  const daySlots = activeDay ? generateSlots(DAY_INDEX[activeDay]) : [];

  return (
    <div className="space-y-4">
      {/* Day buttons row */}
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {DAY_NAMES.map((day) => {
          const hours = OPERATING_HOURS[DAY_INDEX[day]];
          const isActive = activeDay === day;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setActiveDay(isActive ? null : day)}
              className={cn(
                "rounded-lg border px-2 py-2 text-sm font-medium transition-colors text-center",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-input hover:bg-accent"
              )}
            >
              <div>{day.slice(0, 3)}</div>
              <div
                className={cn(
                  "text-[10px] mt-0.5",
                  isActive
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground"
                )}
              >
                {formatTime(hours.open)}-{formatTime(hours.close)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Time slot grid for selected day */}
      {activeDay && (
        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">
            {activeDay} &mdash; Select time slots
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {daySlots.map((startTime) => {
              const selected = isSlotSelected(activeDay, startTime);
              return (
                <Button
                  key={startTime}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleSlot(activeDay, startTime)}
                  className="text-xs"
                >
                  {formatTime(startTime)} &ndash;{" "}
                  {formatTime(addOneHour(startTime))}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export { addOneHour };
