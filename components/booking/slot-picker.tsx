"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn, formatTime } from "@/lib/utils";
import { DAY_NAMES } from "@/lib/constants";
import { OPERATING_HOURS } from "@/config/operating-hours";
import { Plus, X } from "lucide-react";

export interface TimeSlot {
  day: string;
  startTime: string;
}

interface SlotPickerProps {
  slots: TimeSlot[];
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
  const newH = h + 1;
  return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function SlotPicker({ slots, onChange }: SlotPickerProps) {
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState("14:00");

  const getHours = (day: string) => {
    const idx = DAY_INDEX[day];
    return idx !== undefined ? OPERATING_HOURS[idx] : { open: "14:00", close: "20:00" };
  };

  const addSlot = () => {
    if (!selectedDay) return;
    const hours = getHours(selectedDay);

    // Validate: start time must be within operating hours and end (start+1hr) must not exceed close
    const endTime = addOneHour(selectedTime);
    if (selectedTime < hours.open || endTime > hours.close) return;

    // Check for duplicate
    const exists = slots.some(
      (s) => s.day === selectedDay && s.startTime === selectedTime
    );
    if (exists) return;

    onChange([...slots, { day: selectedDay, startTime: selectedTime }]);
    setSelectedDay("");
  };

  const removeSlot = (index: number) => {
    onChange(slots.filter((_, i) => i !== index));
  };

  const currentHours = selectedDay
    ? getHours(selectedDay)
    : { open: "14:00", close: "20:00" };

  // Max start time is close - 1 hour (since class is 1hr)
  const maxStart = (() => {
    const [h, m] = currentHours.close.split(":").map(Number);
    return `${String(h - 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  })();

  const handleTimeChange = (value: string) => {
    if (value < currentHours.open) value = currentHours.open;
    if (value > maxStart) value = maxStart;
    setSelectedTime(value);
  };

  return (
    <div className="space-y-4">
      {/* Added slots */}
      {slots.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">
            Selected time slots
          </Label>
          <div className="flex flex-wrap gap-2">
            {slots.map((slot, i) => (
              <Badge
                key={`${slot.day}-${slot.startTime}`}
                variant="secondary"
                className="gap-1.5 py-1.5 px-3 text-sm"
              >
                {slot.day.slice(0, 3)} {formatTime(slot.startTime)} &ndash;{" "}
                {formatTime(addOneHour(slot.startTime))}
                <button
                  type="button"
                  onClick={() => removeSlot(i)}
                  className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Add new slot */}
      <div className="rounded-lg border p-4 space-y-4">
        <Label>Add a time slot</Label>

        {/* Day selection */}
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {DAY_NAMES.map((day) => {
            const hours = OPERATING_HOURS[DAY_INDEX[day]];
            const isActive = selectedDay === day;
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setSelectedDay(day);
                  // Clamp time to this day's operating hours
                  const dayHours = getHours(day);
                  const dayMaxStart = (() => {
                    const [h, m] = dayHours.close.split(":").map(Number);
                    return `${String(h - 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                  })();
                  if (selectedTime < dayHours.open) setSelectedTime(dayHours.open);
                  if (selectedTime > dayMaxStart) setSelectedTime(dayMaxStart);
                }}
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

        {/* Time selection (only shown when a day is selected) */}
        {selectedDay && (
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="slot-start" className="text-xs text-muted-foreground">
                Start Time (1-hour class)
              </Label>
              <Input
                id="slot-start"
                type="time"
                value={selectedTime}
                onChange={(e) => handleTimeChange(e.target.value)}
                min={currentHours.open}
                max={maxStart}
              />
              <p className="text-xs text-muted-foreground">
                {formatTime(selectedTime)} &ndash;{" "}
                {formatTime(addOneHour(selectedTime))}
              </p>
            </div>
            <Button type="button" onClick={addSlot} size="sm" className="gap-1">
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export { addOneHour };
