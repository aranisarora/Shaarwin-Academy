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
import { markAbsent } from "@/actions/calendar";
import { toast } from "sonner";
import type { UserScheduleEvent } from "@/types/calendar";

interface MarkAbsentDialogProps {
  event: UserScheduleEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function MarkAbsentDialog({
  event,
  open,
  onOpenChange,
  onSuccess,
}: MarkAbsentDialogProps) {
  const [loading, setLoading] = useState(false);

  if (!event) return null;

  const startDate = new Date(event.startTime);
  const dateStr = startDate.toLocaleDateString("en-IN", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await markAbsent({
        eventId: event.id,
        calendarId: event.calendarId,
      });
      toast.success("Marked as absent");
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to mark absent"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as Absent</DialogTitle>
          <DialogDescription>
            Are you sure you want to mark yourself as absent for this class?
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border p-4">
          <p className="font-medium">{event.summary}</p>
          <p className="text-sm text-muted-foreground">{dateStr}</p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "Marking..." : "Confirm Absent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
