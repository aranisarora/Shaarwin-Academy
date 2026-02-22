"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, Clock, XCircle, ArrowRightLeft } from "lucide-react";
import type { UserScheduleEvent } from "@/types/calendar";

interface ClassCardProps {
  event: UserScheduleEvent;
  onMarkAbsent: (event: UserScheduleEvent) => void;
  onReschedule: (event: UserScheduleEvent) => void;
}

export function ClassCard({ event, onMarkAbsent, onReschedule }: ClassCardProps) {
  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);

  const dateStr = startDate.toLocaleDateString("en-IN", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const timeStr = `${startDate.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  })} - ${endDate.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  })}`;

  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    accepted: { label: "Confirmed", variant: "default" },
    needsAction: { label: "Pending", variant: "secondary" },
    declined: { label: "Absent", variant: "destructive" },
    tentative: { label: "Tentative", variant: "outline" },
  };

  const status = statusMap[event.attendeeStatus] || statusMap.needsAction;
  const isDeclined = event.attendeeStatus === "declined";

  return (
    <Card className={isDeclined ? "opacity-60" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="font-medium leading-tight">{event.summary}</h3>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {dateStr}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {timeStr}
              </span>
            </div>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>

        {!isDeclined && (
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMarkAbsent(event)}
              className="text-destructive hover:text-destructive"
            >
              <XCircle className="mr-1 h-3.5 w-3.5" />
              Mark Absent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReschedule(event)}
            >
              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
              Reschedule
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
