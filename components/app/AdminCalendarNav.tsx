"use client";

import { useCallback, useRef, useState, useTransition } from "react";
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

const arrowBtn =
  "pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-line text-fg-2 hover:border-ember hover:text-ember active:border-ember active:text-ember disabled:cursor-not-allowed disabled:opacity-50";

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
  openSessionId = null,
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
  // Deep-link from the Weekly classes tab ("Open this week's session →").
  openSessionId?: string | null;
}) {
  const [anchor, setAnchor] = useState(initialAnchor);
  const [sessions, setSessions] = useState(initialSessions);
  const [rangeLabel, setRangeLabel] = useState(initialRangeLabel);
  const [isPending, startTransition] = useTransition();
  const dateRef = useRef<HTMLInputElement>(null);

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
      {/* Compact one-row pager, sticky beneath the app header so the week you're
          looking at never scrolls away. The centre label opens a date picker;
          "Today" appears only when you're off the current week.
          It hangs off --header-h rather than a hardcoded top-14 (and no longer
          claims lg:top-0, where it was sticking *behind* the header). The
          surface is opaque on purpose: this row and the header sit directly on
          top of one another, so two blurred surfaces meant every scroll frame
          paid for two backdrop-filter passes to render one visible result. */}
      <div className="sticky top-[var(--header-h)] z-20 -mx-5 mb-4 flex items-center gap-2 border-b border-line bg-surface px-5 py-1.5">
        <button
          onClick={() => navigate(shiftWallDate(anchor, -7))}
          disabled={isPending}
          aria-label="Earlier week"
          className={arrowBtn}
        >
          ‹
        </button>
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              const el = dateRef.current;
              if (!el) return;
              // showPicker() is the reliable way to open the native calendar
              // from a custom trigger; fall back to focus where unsupported.
              if (typeof el.showPicker === "function") el.showPicker();
              else el.focus();
            }}
            disabled={isPending}
            className="pressable tnum flex min-h-11 w-full items-center justify-center gap-1.5 truncate rounded-[8px] px-2 text-sm font-medium hover:text-ember active:text-ember disabled:opacity-50"
          >
            {rangeLabel}
            {isThisWeek ? " (this week)" : ""}
            {isPending ? " …" : ""}
            <span aria-hidden className="text-xs text-fg-2">
              ▾
            </span>
          </button>
          <input
            ref={dateRef}
            type="date"
            aria-label="Jump to a date"
            value={anchor}
            onChange={(e) => {
              if (e.target.value) navigate(e.target.value);
            }}
            disabled={isPending}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0"
            tabIndex={-1}
          />
        </div>
        {!isThisWeek && (
          <button
            onClick={() => navigate(today)}
            disabled={isPending}
            className="pressable min-h-11 shrink-0 rounded-[8px] px-2 text-sm font-medium text-ember hover:underline disabled:opacity-50"
          >
            Today
          </button>
        )}
        <button
          onClick={() => navigate(shiftWallDate(anchor, 7))}
          disabled={isPending}
          aria-label="Later week"
          className={arrowBtn}
        >
          ›
        </button>
      </div>
      <AdminCalendar
        sessions={sessions}
        coaches={coaches}
        venues={venues}
        clients={clients}
        invites={invites}
        onRefresh={refreshSessions}
        openSessionId={openSessionId}
      />
    </>
  );
}
