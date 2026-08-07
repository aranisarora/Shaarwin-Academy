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
//
// What this component owns, and why it had to move up here:
//
//   THE FILTERS. Coach, location and type are the same three questions on both
//   sides, and each view used to keep its own copy — so the most prominent
//   control on the page silently threw away "show me only Ravi" every time it
//   was pressed. If they are two views of one thing, narrowing one narrows both.
//
//   WHICH DAYS ARE OPEN. The week strip lives up here and the day cards live in
//   the child, so tapping Thursday scrolled to a Thursday the founder had
//   collapsed earlier and left it collapsed — a jump to a closed pill.
//
//   HOW TALL THE STICKY HEADER IS. The scroll target below it needs to clear
//   it, and that was a hardcoded 10rem against a stack that measures well over
//   200px, so every jump landed with the day heading hidden behind the strip.
//   It is measured now, so it cannot drift when a control changes height.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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

/** The three questions both views ask, held once. */
export type ScheduleFilters = {
  coach: string;
  venue: string;
  type: string;
  setCoach: (v: string) => void;
  setVenue: (v: string) => void;
  setType: (v: string) => void;
};

/** Whether each day / venue card is open, held once so the week strip can open
 *  what it scrolls to. */
export type OpenMap = {
  map: Record<string, boolean>;
  toggle: (key: string, isOpen: boolean) => void;
};

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
    // radiogroup, not tablist. It was marked up as a tablist with no tabpanel,
    // no aria-controls and no arrow keys — a pattern that promises keyboard
    // behaviour it never implemented. Two mutually exclusive choices are radios.
    <div
      role="radiogroup"
      aria-label="Schedule view"
      className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-surface-2 p-1"
    >
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={view === o.value}
          onClick={() => onChange(o.value)}
          className={`pressable min-h-11 rounded-[7px] px-3 text-sm font-semibold transition-colors ${
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

  // ── Shared across both views ───────────────────────────────────────────────
  const [coachFilter, setCoachFilter] = useState("all");
  const [venueFilter, setVenueFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const filters: ScheduleFilters = useMemo(
    () => ({
      coach: coachFilter,
      venue: venueFilter,
      type: typeFilter,
      setCoach: setCoachFilter,
      setVenue: setVenueFilter,
      setType: setTypeFilter,
    }),
    [coachFilter, venueFilter, typeFilter]
  );

  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const days: OpenMap = useMemo(
    () => ({
      map: openDays,
      toggle: (key, isOpen) => setOpenDays((prev) => ({ ...prev, [key]: !isOpen })),
    }),
    [openDays]
  );

  const [openVenues, setOpenVenues] = useState<Record<string, boolean>>({});
  const venueCards: OpenMap = useMemo(
    () => ({
      map: openVenues,
      toggle: (key, isOpen) => setOpenVenues((prev) => ({ ...prev, [key]: !isOpen })),
    }),
    [openVenues]
  );

  // The timetable is fetched the first time it is asked for and kept. Most
  // visits never leave This week, and paying for both on first paint is what
  // would have made one tab slower than two.
  const [timetable, setTimetable] = useState<Timetable | null>(null);
  const loadingTimetable = useRef(false);
  const timetableRef = useRef<Timetable | null>(null);
  useEffect(() => {
    timetableRef.current = timetable;
  });

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

  /** Write the current place into the URL. `push` adds a history entry, so
   *  Back steps a week rather than leaving the Schedule altogether. */
  const writeUrl = useCallback(
    (v: ScheduleView, a: string, push: boolean) => {
      const params = new URLSearchParams();
      if (v === "timetable") params.set("view", "timetable");
      else if (a !== today) params.set("date", a);
      const qs = params.toString();
      const url = qs ? `/admin/schedule?${qs}` : "/admin/schedule";
      if (url === window.location.pathname + window.location.search) return;
      if (push) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [today]
  );

  /** Fetch a week and show it. Does not touch history — callers decide. */
  const load = useCallback(
    (newAnchor: string) => {
      startTransition(async () => {
        const result = await fetchWeekSessions(newAnchor, nextByClass, slotByClass);
        setSessions(result.sessions);
        setAnchor(newAnchor);
        setFocusDate(null);
      });
    },
    [nextByClass, slotByClass]
  );

  const anchorRef = useRef(anchor);
  useEffect(() => {
    anchorRef.current = anchor;
  });

  const navigate = useCallback(
    (newAnchor: string) => {
      load(newAnchor);
      writeUrl("week", newAnchor, true);
    },
    [load, writeUrl]
  );

  function changeView(next: ScheduleView) {
    setView(next);
    if (next === "timetable" && !timetable) loadTimetable();
    writeUrl(next, anchor, true);
  }

  // Back and Forward now mean something inside the tab, so they have to be
  // listened for — a pushState with no popstate handler leaves the URL saying
  // one week and the screen showing another.
  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      const nextView: ScheduleView = p.get("view") === "timetable" ? "timetable" : "week";
      const nextAnchor = p.get("date") ?? today;
      setView(nextView);
      if (nextView === "timetable" && !timetableRef.current) loadTimetable();
      if (nextAnchor !== anchorRef.current) load(nextAnchor);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [today, loadTimetable, load]);

  const refreshSessions = useCallback(() => {
    startTransition(async () => {
      const result = await fetchWeekSessions(anchorRef.current, nextByClass, slotByClass);
      setSessions(result.sessions);
    });
  }, [nextByClass, slotByClass]);

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

  // How much of the screen the sticky header is covering, measured rather than
  // guessed. Handed down as a CSS variable so the day cards can set their own
  // scroll-margin from it.
  const stickyRef = useRef<HTMLDivElement>(null);
  const [stickyH, setStickyH] = useState(0);
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const measure = () => setStickyH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  /** Tapping a day scrolls to it rather than filtering to it: the founder is
   *  asking "what's on Thursday", not "hide everything else", and a filter he
   *  has to remember to clear is how a week goes missing.
   *
   *  It opens the day first. It used not to, so a day he had collapsed stayed
   *  collapsed and the strip delivered him to a shut grey pill. */
  function jumpToDay(date: string) {
    setFocusDate(date);
    setOpenDays((prev) => (prev[date] === false ? { ...prev, [date]: true } : prev));
    // Two frames: one for React to commit the expand, one for the browser to
    // lay it out. Measuring a day that is still collapsed lands short.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .getElementById(`day-${date}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
  }

  return (
    <div
      className="space-y-3"
      style={{ "--sticky-h": `${stickyH}px` } as React.CSSProperties}
    >
      <div
        ref={stickyRef}
        className="sticky top-[var(--header-h)] z-20 -mx-5 space-y-2 border-b border-line bg-surface px-5 pb-2 pt-1.5"
      >
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
          filters={filters}
          days={days}
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
          filters={filters}
          venueCards={venueCards}
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
