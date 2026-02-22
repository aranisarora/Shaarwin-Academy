"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reschedule } from "@/actions/calendar";
import { toast } from "sonner";
import type { UserScheduleEvent } from "@/types/calendar";

interface RescheduleDialogProps {
  event: UserScheduleEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RescheduleDialog({
  event,
  open,
  onOpenChange,
  onSuccess,
}: RescheduleDialogProps) {
  const [loading, setLoading] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newStartTime, setNewStartTime] = useState("");
  const [newEndTime, setNewEndTime] = useState("");

  if (!event) return null;

  const handleConfirm = async () => {
    if (!newDate || !newStartTime || !newEndTime) {
      toast.error("Please fill in all fields");
      return;
    }
    if (newStartTime >= newEndTime) {
      toast.error("End time must be after start time");
      return;
    }

    setLoading(true);
    try {
      const newSlotDateTime = `${newDate}T${newStartTime}:00`;
      const newEndDateTime = `${newDate}T${newEndTime}:00`;

      await reschedule({
        oldEventId: event.id,
        oldCalendarId: event.calendarId,
        newSlotDateTime,
        newEndDateTime,
      });
      toast.success("Class rescheduled successfully");
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to reschedule"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule Class</DialogTitle>
          <DialogDescription>
            Choose a new date and time for &quot;{event.summary}&quot;
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newDate">New Date</Label>
            <Input
              id="newDate"
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="newStartTime">Start Time</Label>
              <Input
                id="newStartTime"
                type="time"
                value={newStartTime}
                onChange={(e) => setNewStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newEndTime">End Time</Label>
              <Input
                id="newEndTime"
                type="time"
                value={newEndTime}
                onChange={(e) => setNewEndTime(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? "Rescheduling..." : "Confirm Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
