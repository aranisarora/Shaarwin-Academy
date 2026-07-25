"use client";

// The Weekly classes tab: every repeating class, grouped under the venue it
// runs at and then by day within that venue. Each venue is a card; under a
// day sub-heading the classes read coach · time. Tap a class to change it for
// every week; one-week-only changes happen on that session in the Schedule tab.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { FilterBar, type FilterDef } from "@/components/ui/FilterBar";
import { Fab } from "@/components/ui/Fab";
import { Sheet } from "@/components/ui/Sheet";
import { topUpSessions } from "@/app/admin/schedule/actions";
import { AdminClassSheet } from "./AdminClassSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import { WeeklyClassCard } from "./ClassCard";
import {
  WEEKDAY_NAME,
  WEEKDAYS,
  wallDate,
  type ClassRow,
  type ClientOption,
  type Coach,
  type InviteOption,
  type PrivateSeriesRow,
  type Venue,
} from "./admin-calendar-types";

const WEEKDAY_ORDER = WEEKDAYS.map(([code]) => code) as string[];

/** "5:00 pm" from an "HH:MM" IST wall-clock string (series slot time). */
function fmtSlotTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function AdminWeeklyClasses({
  classes,
  privateSeries = [],
  coaches,
  venues,
  clients,
  invites,
  openClassId = null,
}: {
  classes: ClassRow[];
  // Active client weekly privates, grouped under the same locations as classes.
  privateSeries?: PrivateSeriesRow[];
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
  // Deep-link from the Schedule tab ("edit the weekly class") — open this class
  // straight away so the two tabs feel like one thing.
  openClassId?: string | null;
}) {
  const router = useRouter();
  const [editingClass, setEditingClass] = useState<ClassRow | null>(
    () => classes.find((c) => c.id === openClassId) ?? null
  );
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Success/status lines show as a bottom toast that clears itself, so they
  // never reserve layout space above the list.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  function topUp() {
    startTransition(async () => {
      const r = await topUpSessions();
      setMessage(
        r.ok
          ? r.created
            ? `Added ${r.created} upcoming sessions.`
            : "The schedule is already fully topped up."
          : (r.error ?? "Failed.")
      );
      if (r.ok) router.refresh();
    });
  }

  // Filters — location (venue), day and status. Options are drawn from the
  // classes that actually exist so we never show an empty bucket.
  const [venueFilter, setVenueFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");

  // Location + day options are drawn from both classes and private series so a
  // location that only hosts a private slot still appears in the filter.
  const venueOptions = useMemo(
    () =>
      [
        ...new Set([
          ...classes.map((c) => c.venueName ?? ""),
          ...privateSeries.map((p) => p.venueName),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [classes, privateSeries]
  );
  const dayOptions = useMemo(
    () =>
      [
        ...new Set([
          ...classes.map((c) => c.weekday),
          ...privateSeries.map((p) => p.weekday),
        ]),
      ].sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b)),
    [classes, privateSeries]
  );

  const filteredClasses = useMemo(
    () =>
      classes.filter((c) => {
        if (venueFilter !== "all" && (c.venueName ?? "") !== venueFilter) return false;
        if (dayFilter !== "all" && c.weekday !== dayFilter) return false;
        if (statusFilter === "active" && !c.active) return false;
        if (statusFilter === "paused" && (c.active || c.endsOn)) return false;
        if (statusFilter === "ended" && (c.active || !c.endsOn)) return false;
        return true;
      }),
    [classes, venueFilter, dayFilter, statusFilter]
  );

  // Private series are always active (the page only queries active ones), so
  // they show under "active"/"all" and drop out of the "paused"/"ended" views.
  const filteredPrivates = useMemo(
    () =>
      privateSeries.filter((p) => {
        if (venueFilter !== "all" && p.venueName !== venueFilter) return false;
        if (dayFilter !== "all" && p.weekday !== dayFilter) return false;
        if (statusFilter === "paused" || statusFilter === "ended") return false;
        return true;
      }),
    [privateSeries, venueFilter, dayFilter, statusFilter]
  );

  // Curated venue names — a group with no group-classes that isn't a curated
  // venue is a pure client-home location and gets the [private] badge.
  const curatedNames = useMemo(
    () => new Set(venues.map((v) => v.name.toLowerCase())),
    [venues]
  );

  // Group the filtered classes under their venue, then by day within that
  // venue. Days run Mon→Sun; classes under each day are sorted by time so the
  // card reads top-to-bottom in slot order. Venues themselves are listed
  // alphabetically, "No venue" last.
  const venueGroups = useMemo(() => {
    const classesByVenue = new Map<string, ClassRow[]>();
    for (const c of filteredClasses) {
      const key = c.venueName ?? "";
      (classesByVenue.get(key) ?? classesByVenue.set(key, []).get(key)!).push(c);
    }
    const privatesByVenue = new Map<string, PrivateSeriesRow[]>();
    for (const p of filteredPrivates) {
      (privatesByVenue.get(p.venueName) ?? privatesByVenue.set(p.venueName, []).get(p.venueName)!).push(p);
    }

    const allVenues = new Set([...classesByVenue.keys(), ...privatesByVenue.keys()]);
    return [...allVenues]
      .map((venue) => {
        const classRows = classesByVenue.get(venue) ?? [];
        const privateRows = privatesByVenue.get(venue) ?? [];
        // Days are the union of weekdays present in either kind; each day sorts
        // classes then privates by slot time.
        const byDay = new Map<string, { rows: ClassRow[]; privates: PrivateSeriesRow[] }>();
        const bucket = (wk: string) =>
          byDay.get(wk) ?? byDay.set(wk, { rows: [], privates: [] }).get(wk)!;
        for (const c of classRows) bucket(c.weekday).rows.push(c);
        for (const p of privateRows) bucket(p.weekday).privates.push(p);
        const days = [...byDay.entries()]
          .map(([weekday, d]) => ({
            weekday,
            rows: d.rows.sort((a, b) => a.time.localeCompare(b.time)),
            privates: d.privates.sort((a, b) => a.time.localeCompare(b.time)),
          }))
          .sort(
            (a, b) => WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday)
          );
        // Pure client-home location: only privates, and not a curated venue.
        const privateOnly =
          classRows.length === 0 && !!venue && !curatedNames.has(venue.toLowerCase());
        return {
          venue,
          classCount: classRows.length,
          privateCount: privateRows.length,
          days,
          privateOnly,
        };
      })
      .sort((a, b) => {
        if (!a.venue) return 1;
        if (!b.venue) return -1;
        return a.venue.localeCompare(b.venue);
      });
  }, [filteredClasses, filteredPrivates, curatedNames]);

  // On the phone the page opens one screen tall: only the first venue is
  // expanded, the rest collapse to a header + count. `toggled` holds the venues
  // the founder has flipped from their default (first-open, others-closed), so a
  // tap always does the obvious thing. Desktop ignores this via CSS (lg:block).
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const toggleVenue = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const filterDefs: FilterDef[] = [
    {
      key: "venue",
      aria: "Filter by location",
      label: "All locations",
      value: venueFilter,
      defaultValue: "all",
      onChange: setVenueFilter,
      options: [
        { value: "all", label: "All locations" },
        ...venueOptions.map((v) => ({ value: v, label: v || "No venue" })),
      ],
    },
    {
      key: "day",
      aria: "Filter by day",
      label: "Any day",
      value: dayFilter,
      defaultValue: "all",
      onChange: setDayFilter,
      options: [
        { value: "all", label: "Any day" },
        ...dayOptions.map((d) => ({ value: d, label: WEEKDAY_NAME[d] ?? d })),
      ],
    },
    {
      key: "status",
      aria: "Filter by status",
      label: "Any status",
      value: statusFilter,
      defaultValue: "active",
      onChange: setStatusFilter,
      options: [
        { value: "all", label: "All statuses" },
        { value: "active", label: "Active" },
        { value: "paused", label: "Paused" },
        { value: "ended", label: "Ended" },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {/* Desktop keeps the inline "Create a class" button; the ⋯ holds the rare
          maintenance bits. On the phone, Create is a FAB (below). */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          aria-label="More options"
          onClick={() => setOverflowOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-line text-lg text-fg-2 hover:border-ember hover:text-ember"
        >
          ⋯
        </button>
        <Button
          className="hidden lg:inline-flex"
          onClick={() => {
            setCreating(true);
            setMessage(null);
          }}
        >
          Create a class
        </Button>
      </div>

      {classes.length + privateSeries.length > 0 && <FilterBar filters={filterDefs} />}

      {venueGroups.map((group, i) => {
        const key = group.venue || "no-venue";
        // First venue open by default, others collapsed; a tap flips it.
        const open = i === 0 ? !toggled.has(key) : toggled.has(key);
        return (
        <div
          key={key}
          className="overflow-hidden rounded-[14px] border border-line bg-surface-2"
        >
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggleVenue(key)}
            className="flex w-full items-baseline justify-between gap-3 border-b border-line px-4 py-3 text-left hover:bg-surface"
          >
            <span className="flex items-baseline gap-2">
              <span
                className={`text-fg-2 transition-transform lg:rotate-90 ${open ? "rotate-90" : ""}`}
                aria-hidden
              >
                ›
              </span>
              <span className="font-semibold">{group.venue || "No venue"}</span>
              {group.privateOnly && (
                <span className="rounded-full border border-line px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-fg-2">
                  private
                </span>
              )}
            </span>
            <span className="shrink-0 text-sm text-fg-2">
              {group.classCount > 0 &&
                `${group.classCount} class${group.classCount === 1 ? "" : "es"}`}
              {group.classCount > 0 && group.privateCount > 0 && " · "}
              {group.privateCount > 0 && `${group.privateCount} private`}
            </span>
          </button>
          <div className={`divide-y divide-line lg:block ${open ? "block" : "hidden"}`}>
            {group.days.map((day) => (
              <div key={day.weekday} className="px-4 py-3">
                <p className="label mb-1.5">{WEEKDAY_NAME[day.weekday] ?? "One-off"}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {day.rows.map((c) => (
                    <WeeklyClassCard
                      key={c.id}
                      cls={c}
                      onClick={() => {
                        setMessage(null);
                        setEditingClass(c);
                      }}
                    />
                  ))}
                  {day.privates.map((p) => (
                    <PrivateSeriesCard key={p.id} series={p} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        );
      })}
      {classes.length + privateSeries.length === 0 && (
        <div className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          <p className="font-medium text-fg">Add each class you run — day, time, place.</p>
          <p className="mt-1">
            We&apos;ll build the weekly schedule and handle bookings, reminders and
            reschedules from there. Tap &ldquo;Create a class&rdquo; to start.
          </p>
        </div>
      )}
      {classes.length + privateSeries.length > 0 &&
        filteredClasses.length + filteredPrivates.length === 0 && (
          <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
            No classes match these filters.
          </p>
        )}

      {/* Phone: Create a class as a floating button above the tab bar. */}
      <Fab
        label="Create a class"
        onClick={() => {
          setCreating(true);
          setMessage(null);
        }}
      />

      {/* ⋯ overflow: the explainer + the rare "top up" maintenance action. */}
      <Sheet open={overflowOpen} onClose={() => setOverflowOpen(false)} title="Weekly classes">
        <div className="space-y-4">
          <p className="text-sm text-fg-2">
            Each class repeats every week and fills the Schedule tab. Tap one to change it —
            for a one-week-only change, tap that session in the Schedule tab instead.
          </p>
          <div className="space-y-2 rounded-[12px] border border-line p-4">
            <p className="label">Top up the next 8 weeks</p>
            <p className="text-sm text-fg-2">
              Extends every class&apos;s upcoming sessions so the schedule never runs dry. Runs
              automatically — you rarely need this.
            </p>
            <Button
              variant="ghost"
              disabled={pending}
              className="w-full"
              onClick={() => {
                topUp();
                setOverflowOpen(false);
              }}
            >
              {pending ? "Topping up…" : "Top up now"}
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Transient status line as a bottom toast — no reserved layout space. */}
      {message && (
        <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 mx-auto max-w-md rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2 shadow-[var(--shadow-sheet)] lg:bottom-6">
          {message}
        </div>
      )}

      {editingClass && (
        <AdminClassSheet
          key={editingClass.id}
          cls={editingClass}
          coaches={coaches}
          venues={venues}
          onClose={() => setEditingClass(null)}
          onDone={(m) => {
            setMessage(m);
            setEditingClass(null);
            router.refresh();
          }}
        />
      )}

      {creating && (
        <AdminAddSheet
          variant="create"
          onClose={() => setCreating(false)}
          onDone={(m) => {
            setMessage(m);
            setCreating(false);
            router.refresh();
          }}
          coaches={coaches}
          venues={venues}
          clients={clients}
          invites={invites}
        />
      )}
    </div>
  );
}

/** A client weekly private slot on the Weekly tab — view-only, sharing the class
 * card's grammar (day + time bold, then the who). Deep-links to its next
 * generated session on the Schedule tab; end/reassign live there, not here. The
 * ember left-stripe marks it private, matching the schedule's private sessions. */
function PrivateSeriesCard({ series }: { series: PrivateSeriesRow }) {
  const dayShort = (WEEKDAY_NAME[series.weekday] ?? series.weekday).slice(0, 3);
  const inner = (
    <>
      <p className="font-semibold">
        Every {dayShort} · {fmtSlotTime(series.time)}
      </p>
      <p className="text-fg-2">
        {series.playerName} <span className="text-fg-2">(private)</span>
      </p>
      <p className="text-xs text-fg-2">
        {series.duration} min
        {series.clientName ? ` · ${series.clientName}` : ""}
        {series.coachName ? ` · ${series.coachName}` : ""}
      </p>
    </>
  );
  const cls =
    "block w-full rounded-[8px] border border-line border-l-[3px] border-l-ember bg-surface-2 px-3 py-2 text-left text-sm";
  if (series.nextSessionId && series.nextSessionStart) {
    return (
      <Link
        href={`/admin/schedule?date=${wallDate(series.nextSessionStart)}&session=${series.nextSessionId}`}
        className={`${cls} hover:border-ember`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}
