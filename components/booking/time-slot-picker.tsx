"use client";

import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { OPERATING_HOURS } from "@/config/operating-hours";
import { formatTime } from "@/lib/utils";

interface TimeSlotPickerProps {
  startTime: string;
  endTime: string;
  onStartTimeChange: (time: string) => void;
  onEndTimeChange: (time: string) => void;
  selectedDays: string[];
  error?: string;
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

function getOperatingRange(selectedDays: string[]) {
  if (selectedDays.length === 0) {
    return { open: "14:00", close: "20:00" };
  }

  const hours = selectedDays
    .map((day) => OPERATING_HOURS[DAY_INDEX[day]])
    .filter(Boolean);

  if (hours.length === 0) {
    return { open: "14:00", close: "20:00" };
  }

  // Most restrictive range: latest open, earliest close
  const open = hours.reduce(
    (latest, h) => (h.open > latest ? h.open : latest),
    hours[0].open
  );
  const close = hours.reduce(
    (earliest, h) => (h.close < earliest ? h.close : earliest),
    hours[0].close
  );

  return { open, close };
}

export function TimeSlotPicker({
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  selectedDays,
  error,
}: TimeSlotPickerProps) {
  const { open, close } = getOperatingRange(selectedDays);

  // Clamp values when operating range changes
  useEffect(() => {
    if (startTime && startTime < open) onStartTimeChange(open);
    if (endTime && endTime > close) onEndTimeChange(close);
    if (startTime && startTime > close) onStartTimeChange(open);
    if (endTime && endTime < open) onEndTimeChange(close);
  }, [open, close]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartChange = (value: string) => {
    if (value < open) value = open;
    if (value > close) value = close;
    onStartTimeChange(value);
  };

  const handleEndChange = (value: string) => {
    if (value < open) value = open;
    if (value > close) value = close;
    onEndTimeChange(value);
  };

  const isOutOfRange =
    (startTime && (startTime < open || startTime > close)) ||
    (endTime && (endTime < open || endTime > close));
  const isInvalidRange = startTime && endTime && startTime >= endTime;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Select Time</Label>
        <span className="text-xs text-muted-foreground">
          Hours: {formatTime(open)} &ndash; {formatTime(close)}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="startTime" className="text-xs text-muted-foreground">
            Start Time
          </Label>
          <Input
            id="startTime"
            type="time"
            value={startTime}
            onChange={(e) => handleStartChange(e.target.value)}
            min={open}
            max={close}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endTime" className="text-xs text-muted-foreground">
            End Time
          </Label>
          <Input
            id="endTime"
            type="time"
            value={endTime}
            onChange={(e) => handleEndChange(e.target.value)}
            min={startTime || open}
            max={close}
          />
        </div>
      </div>
      {isOutOfRange && (
        <p className="text-sm text-destructive">
          Time must be within operating hours ({formatTime(open)} &ndash;{" "}
          {formatTime(close)})
        </p>
      )}
      {isInvalidRange && !isOutOfRange && (
        <p className="text-sm text-destructive">
          End time must be after start time
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export { getOperatingRange };
