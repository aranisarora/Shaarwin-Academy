"use client";

import { useCallback, useState, useTransition } from "react";
import { fetchWeekSessions } from "@/app/admin/schedule/actions";
import { shiftWallDate } from "@/lib/academy-time";
import { AdminCalendar } from "./AdminCalendar";
import type {
  ClientOption,
  Coach,
  InviteOption,
  SessionRow,
  Venue,
} from "./admin-calendar-types";

const navBtn =
  "rounded-[8px] border border-line px-4 py-2 text-sm hover:border-ember hover:text-ember disabled:opacity-50 disabled:cursor-not-allowed";

export function AdminCalendarNav({
  initialAnchor,
  today,
  initialSessions,
  initialRangeLabel,
  nextByClass,
  coaches,
  venues,
  clients,
  invites,
}: {
  // The 7-day window starts on `initialAnchor` (a "YYYY-MM-DD" academy wall
  // date); `today` is the academy date at load, used to reset and to flag the
  // current week.
  initialAnchor: string;
  today: string;
  initialSessions: SessionRow[];
  initialRangeLabel: string;
  nextByClass: Record<string, string>;
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
}) {
  const [anchor, setAnchor] = useState(initialAnchor);
  const [sessions, setSessions] = useState(initialSessions);
  const [rangeLabel, setRangeLabel] = useState(initialRangeLabel);
  const [isPending, startTransition] = useTransition();

  const navigate = (newAnchor: string) => {
    startTransition(async () => {
      const result = await fetchWeekSessions(newAnchor, nextByClass);
      setSessions(result.sessions);
      setAnchor(newAnchor);
      setRangeLabel(result.rangeLabel);
      // Update URL without triggering a Next.js server re-render. The current
      // week stays on the bare path so it's the canonical/shareable default.
      const url =
        newAnchor !== today ? `/admin/schedule?date=${newAnchor}` : "/admin/schedule";
      window.history.replaceState(null, "", url);
    });
  };

  // Called by AdminCalendar after any successful mutation so the session list
  // stays fresh without a full page reload.
  const refreshSessions = useCallback(() => {
    startTransition(async () => {
      const result = await fetchWeekSessions(anchor, nextByClass);
      setSessions(result.sessions);
    });
  }, [anchor, nextByClass]);

  const isThisWeek = anchor === today;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => navigate(shiftWallDate(anchor, -7))}
            disabled={isPending}
            className={navBtn}
          >
            ← Earlier
          </button>
          <button
            onClick={() => navigate(shiftWallDate(anchor, 7))}
            disabled={isPending}
            className={navBtn}
          >
            Later →
          </button>
          <input
            type="date"
            aria-label="Jump to a date"
            value={anchor}
            onChange={(e) => {
              if (e.target.value) navigate(e.target.value);
            }}
            disabled={isPending}
            className="rounded-[8px] border border-line bg-surface-2 px-3 py-2 text-sm text-fg hover:border-ember focus:border-ember focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          {!isThisWeek && (
            <button onClick={() => navigate(today)} disabled={isPending} className={navBtn}>
              This week
            </button>
          )}
        </div>
        <p className="tnum text-sm text-fg-2">
          {rangeLabel}
          {isThisWeek ? " (this week)" : ""}
          {isPending ? " …" : ""}
        </p>
      </div>
      <AdminCalendar
        sessions={sessions}
        coaches={coaches}
        venues={venues}
        clients={clients}
        invites={invites}
        onRefresh={refreshSessions}
      />
    </>
  );
}
