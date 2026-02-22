"use client";

import { cn, formatTime } from "@/lib/utils";
import { DAY_NAMES } from "@/lib/constants";
import { OPERATING_HOURS } from "@/config/operating-hours";

interface DaySelectorProps {
  selected: string[];
  onChange: (days: string[]) => void;
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

export function DaySelector({ selected, onChange }: DaySelectorProps) {
  const toggleDay = (day: string) => {
    if (selected.includes(day)) {
      onChange(selected.filter((d) => d !== day));
    } else {
      onChange([...selected, day]);
    }
  };

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {DAY_NAMES.map((day) => {
        const hours = OPERATING_HOURS[DAY_INDEX[day]];
        const isSelected = selected.includes(day);

        return (
          <button
            key={day}
            type="button"
            onClick={() => toggleDay(day)}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium transition-colors text-center",
              isSelected
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground border-input hover:bg-accent"
            )}
          >
            <div>{day.slice(0, 3)}</div>
            <div
              className={cn(
                "text-[10px] mt-0.5",
                isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
              )}
            >
              {formatTime(hours.open)}-{formatTime(hours.close)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
