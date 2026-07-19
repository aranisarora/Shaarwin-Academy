"use client";

import { useCallback, useState, useTransition } from "react";
import { fetchWeekSessions } from "@/app/admin/schedule/actions";
import { AdminCalendar } from "./AdminCalendar";
import type {
  ClassRow,
  ClientOption,
  Coach,
  InviteOption,
  SessionRow,
  Venue,
} from "./admin-calendar-types";

const navBtn =
  "rounded-[8px] border border-line px-4 py-2 text-sm hover:border-ember hover:text-ember disabled:opacity-50 disabled:cursor-not-allowed";

export function AdminCalendarNav({
  initialWeekOffset,
  initialSessions,
  initialRangeLabel,
  nextByClass,
  coaches,
  classes,
  venues,
  clients,
  invites,
}: {
  initialWeekOffset: number;
  initialSessions: SessionRow[];
  initialRangeLabel: string;
  nextByClass: Record<string, string>;
  coaches: Coach[];
  classes: ClassRow[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
}) {
  const [weekOffset, setWeekOffset] = useState(initialWeekOffset);
  const [sessions, setSessions] = useState(initialSessions);
  const [rangeLabel, setRangeLabel] = useState(initialRangeLabel);
  const [isPending, startTransition] = useTransition();

  const navigate = (newOffset: number) => {
    startTransition(async () => {
      const result = await fetchWeekSessions(newOffset, nextByClass);
      setSessions(result.sessions);
      setWeekOffset(newOffset);
      setRangeLabel(result.rangeLabel);
      // Update URL without triggering a Next.js server re-render
      const url = newOffset !== 0 ? `/admin/schedule?week=${newOffset}` : "/admin/schedule";
      window.history.replaceState(null, "", url);
    });
  };

  // Called by AdminCalendar after any successful mutation so the session list
  // stays fresh without a full page reload.
  const refreshSessions = useCallback(() => {
    startTransition(async () => {
      const result = await fetchWeekSessions(weekOffset, nextByClass);
      setSessions(result.sessions);
    });
  }, [weekOffset, nextByClass]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(weekOffset - 1)}
            disabled={isPending}
            className={navBtn}
          >
            ← Earlier
          </button>
          {weekOffset !== 0 && (
            <button onClick={() => navigate(0)} disabled={isPending} className={navBtn}>
              This week
            </button>
          )}
          <button
            onClick={() => navigate(weekOffset + 1)}
            disabled={isPending}
            className={navBtn}
          >
            Later →
          </button>
        </div>
        <p className="tnum text-sm text-fg-2">
          {rangeLabel}
          {weekOffset === 0 ? " (this week)" : ""}
          {isPending ? " …" : ""}
        </p>
      </div>
      <AdminCalendar
        sessions={sessions}
        coaches={coaches}
        classes={classes}
        venues={venues}
        clients={clients}
        invites={invites}
        onRefresh={refreshSessions}
      />
    </>
  );
}
