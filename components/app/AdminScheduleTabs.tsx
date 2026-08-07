"use client";

// The Schedule tab, which is two views of one thing.
//
//   This week — what is happening, on dates. Editing here changes THAT DATE.
//   Timetable — what you run, every week. Editing here changes EVERY WEEK.
//
// They used to be two tabs called "Schedule" and "Weekly", which is two time
// words for two things neither of which is really about time — and each name
// described the other, because the schedule shows a seven-day window and the
// weekly list shows a Mon–Sun grid. Naming them for what an edit REACHES is the
// whole trick: you can read the consequence off the control before you touch
// anything, the way Google Calendar's "this event / all events" does.
//
// One tab, one at a time. This is not the old merge that had to be undone (see
// /admin/classes, "one page for the schedule and the weekly classes behind
// it") — that put both lists on one page, so the churn of cancellations and
// moves buried the standing pattern. These two read different tables entirely,
// so the timetable cannot be polluted by a week's exceptions no matter what
// happens to them.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { fetchTimetable, fetchWeekSessions, type Timetable } from "@/app/admin/schedule/actions";
import { shiftWallDate, wallDate } from "@/lib/academy-time";
import { AdminCalendar } from "./AdminCalendar";
import { AdminWeeklyClasses } from "./AdminWeeklyClasses";
import { WeekStrip, type DayDensity } from "./WeekStrip";
import { PageSkeleton } from "@/components/ui/Skeleton";
import type {
  ClientOption,
  Coach,
  InviteOption,
  SessionRow,
  Venue,
} from "./admin-calendar-types";

export type ScheduleView = "week" | "timetable";

/** The mode switch. Deliberately two words each, and deliberately not icons —
 *  this is the one control that says what an edit will reach, so it says it. */
function ViewToggle({
  view,
  onChange,
}: {
  view: ScheduleView;
  onChange: (v: ScheduleView) => void;
}) {
  const opts: { value: ScheduleView; label: string }[] = [
    { value: "week", label: "This week" },
    { value: "timetable", label: "Timetable" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Schedule view"
      className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-surface-2 p-1"
    >
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={view === o.value}
          onClick={() => onChange(o.value)}
          className={`pressable min-h-9 rounded-[7px] px-3 text-sm font-semibold transition-colors ${
            view === o.value
              ? "bg-ember text-ivory"
              : "text-fg-2 hover:text-ember"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AdminScheduleTabs({
  initialAnchor,
  today,
  initialSessions,
  nextByClass,
  slotByClass,
  coaches,
  venues,
  clients,
  invites,
  openSessionId = null,
  openClassId = null,
  initialView = "week",
}: {
  initialAnchor: string;
  today: string;
  initialSessions: SessionRow[];
  nextByClass: Record<string, string>;
  slotByClass: Record<string, string>;
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
  openSessionId?: string | null;
  openClassId?: string | null;
  initialView?: ScheduleView;
}) {
  const [view, setView] = useState<ScheduleView>(initialView);
  const [anchor, setAnchor] = useState(initialAnchor);
  const [sessions, setSessions] = useState(initialSessions);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // The timetable is fetched the first time it is asked for and kept. Most
  // visits never leave This week, and paying for both on first paint is what
  // would have made one tab slower than two.
  const [timetable, setTimetable] = useState<Timetable | null>(null);
  const loadingTimetable = useRef(false);

  const loadTimetable = useCallback(() => {
    if (loadingTimetable.current) return;
    loadingTimetable.current = true;
    startTransition(async () => {
      try {
        setTimetable(await fetchTimetable());
      } finally {
        loadingTimetable.current = false;
      }
    });
  }, []);

  // A deep link straight to ?view=timetable has to fetch before it can paint.
  useEffect(() => {
    if (initialView === "timetable") loadTimetable();
  }, [initialView, loadTimetable]);

  /** Keep the URL honest without a server round trip — the current week on the
   *  bare path so it stays the canonical, shareable default. */
  const syncUrl = useCallback(
    (v: ScheduleView, a: string) => {
      const params = new URLSearchParams();
      if (v === "timetable") params.set("view", "timetable");
      else if (a !== today) params.set("date", a);
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `/admin/schedule?${qs}` : "/admin/schedule");
    },
    [today]
  );

  function changeView(next: ScheduleView) {
    setView(next);
    if (next === "timetable" && !timetable) loadTimetable();
    syncUrl(next, anchor);
  }

  const navigate = useCallback(
    (newAnchor: string) => {
      startTransition(async () => {
        const result = await fetchWeekSessions(newAnchor, nextByClass, slotByClass);
        setSessions(result.sessions);
        setAnchor(newAnchor);
        setFocusDate(null);
        syncUrl("week", newAnchor);
      });
    },
    [nextByClass, slotByClass, syncUrl]
  );

  const refreshSessions = useCallback(() => {
    startTransition(async () => {
      const result = await fetchWeekSessions(anchor, nextByClass, slotByClass);
      setSessions(result.sessions);
    });
  }, [anchor, nextByClass, slotByClass]);

  /** The timetable mutates through its own sheets; re-fetch rather than
   *  router.refresh(), because the server page no longer holds this data. */
  const refreshTimetable = useCallback(() => {
    loadingTimetable.current = false;
    loadTimetable();
  }, [loadTimetable]);

  // How full each day of the shown week is — the strip's whole job.
  const density: DayDensity[] = useMemo(() => {
    const byDate = new Map<string, DayDensity>();
    for (const s of sessions) {
      const date = wallDate(s.starts_at);
      let d = byDate.get(date);
      if (!d) byDate.set(date, (d = { date, live: 0, cancelled: 0 }));
      if (s.status === "cancelled") d.cancelled += 1;
      else d.live += 1;
    }
    return [...byDate.values()];
  }, [sessions]);

  /** Tapping a day scrolls to it rather than filtering to it: the founder is
   *  asking "what's on Thursday", not "hide everything else", and a filter he
   *  has to remember to clear is how a week goes missing. */
  function jumpToDay(date: string) {
    setFocusDate(date);
    document
      .getElementById(`day-${date}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-[var(--header-h)] z-20 -mx-5 space-y-2 border-b border-line bg-surface px-5 pb-2 pt-1.5">
        <ViewToggle view={view} onChange={changeView} />
        {view === "week" && (
          <WeekStrip
            anchor={anchor}
            today={today}
            days={density}
            pending={isPending}
            selected={focusDate}
            onShift={(delta) => navigate(shiftWallDate(anchor, delta))}
            onToday={() => navigate(today)}
            onPick={jumpToDay}
          />
        )}
      </div>

      {view === "week" ? (
        <AdminCalendar
          sessions={sessions}
          coaches={coaches}
          venues={venues}
          clients={clients}
          invites={invites}
          onRefresh={refreshSessions}
          openSessionId={openSessionId}
        />
      ) : timetable ? (
        <AdminWeeklyClasses
          classes={timetable.classes}
          privateSeries={timetable.privateSeries}
          oneOffCount={timetable.oneOffCount}
          coaches={coaches}
          venues={venues}
          clients={clients}
          invites={invites}
          openClassId={openClassId}
          onRefresh={refreshTimetable}
          onShowThisWeek={() => changeView("week")}
        />
      ) : (
        <PageSkeleton />
      )}
    </div>
  );
}
