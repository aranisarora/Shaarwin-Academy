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
import { AdminBulkRemoveSheet } from "./AdminBulkRemoveSheet";
import { AdminWipeCalendarSheet } from "./AdminWipeCalendarSheet";
import { PrivateSeriesCard, WeeklyClassCard } from "./ClassCard";
import {
  WEEKDAY_NAME,
  WEEKDAYS,
  type ClassRow,
  type ClientOption,
  type Coach,
  type InviteOption,
  type PrivateSeriesRow,
  type Venue,
} from "./admin-calendar-types";

const WEEKDAY_ORDER = WEEKDAYS.map(([code]) => code) as string[];

export function AdminWeeklyClasses({
  classes,
  privateSeries = [],
  oneOffCount = 0,
  coaches,
  venues,
  clients,
  invites,
  openClassId = null,
}: {
  classes: ClassRow[];
  // Active client weekly privates, grouped under the same locations as classes.
  privateSeries?: PrivateSeriesRow[];
  // Group classes that run on a date rather than every week, and so aren't on
  // this list at all. Only the count reaches here — see the note in page.tsx.
  oneOffCount?: number;
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

  // Selection mode — clearing a timetable is a bulk job, so the founder flips
  // the whole list into checkboxes rather than opening thirty sheets.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A SECOND set, not a merged one. Weekly private slots are rows in
  // private_booking_series, which has no foreign key to classes at all — one id
  // handed to the wrong core matches nothing, is silently dropped, and the
  // founder is told "Nothing changed." Keeping them apart in the UI is what
  // keeps them apart all the way down to the two plans.
  const [selectedSeries, setSelectedSeries] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);

  // Stable array identity — the confirm sheet fetches its preview in an effect
  // keyed on these, so a fresh `[...selected]` each render would refetch.
  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedSeriesIds = useMemo(() => [...selectedSeries], [selectedSeries]);

  // The selection bar and the toast are pinned to the same spot, so exactly one
  // of them may be on screen at a time — and it has to be this condition, not
  // `selecting`, or a founder who flips into selection mode without picking
  // anything loses a status line to a bar that isn't there.
  const selectionCount = selected.size + selectedSeries.size;
  const selectionBarShowing = selecting && selectionCount > 0;

  function exitSelect() {
    setSelecting(false);
    setSelected(new Set());
    setSelectedSeries(new Set());
    setConfirming(false);
  }
  const toggleIn = (
    set: (fn: (prev: Set<string>) => Set<string>) => void,
    id: string
  ) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleClass = (id: string) => toggleIn(setSelected, id);
  const toggleSeries = (id: string) => toggleIn(setSelectedSeries, id);

  // Success/status lines show as a bottom toast that clears itself, so they
  // never reserve layout space above the list.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  function topUp() {
    startTransition(async () => {
      try {
        const r = await topUpSessions();
        setMessage(
          r.ok
            ? r.created
              ? `Added ${r.created} upcoming sessions.`
              : "The schedule is already fully topped up."
            : (r.error ?? "Failed.")
        );
        if (r.ok) router.refresh();
      } catch {
        setMessage("Couldn't reach the server. Nothing changed — try again.");
      }
    });
  }

  // Filters — location (venue), day and status. Options are drawn from the
  // classes that actually exist so we never show an empty bucket.
  //
  // Status starts at "all", not "active". It used to hide the ended and paused
  // ones, which sounds tidy until you follow what the founder actually does:
  // he ends a class, the class vanishes from the list, and the thing he now
  // wants to delete is somewhere he has to guess at — and "Select all 38" was
  // quietly only the active 38, so a timetable clear-out left the ended ones
  // behind. The cards already grey themselves out and say "Ended" or "Paused",
  // so nothing is lost by showing them, and Active is one tap away.
  const [venueFilter, setVenueFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

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

  // "Select all" means everything the filters are currently showing — so
  // narrowing to one venue or one day makes it a targeted clear, and leaving the
  // filters wide (status: all) makes it the full reset of this screen. It now
  // covers the weekly private slots as well: leaving them out made "Select all
  // 47" a promise the screen did not keep.
  const filteredIds = useMemo(() => filteredClasses.map((c) => c.id), [filteredClasses]);
  const filteredSeriesIds = useMemo(() => filteredPrivates.map((p) => p.id), [filteredPrivates]);
  const filteredTotal = filteredIds.length + filteredSeriesIds.length;
  const allSelected =
    filteredTotal > 0 &&
    filteredIds.every((id) => selected.has(id)) &&
    filteredSeriesIds.every((id) => selectedSeries.has(id));

  function selectAllFiltered() {
    setSelecting(true);
    setSelected(allSelected ? new Set() : new Set(filteredIds));
    setSelectedSeries(allSelected ? new Set() : new Set(filteredSeriesIds));
  }

  /** Select/clear everything under one venue card — clearing a venue is the
   * common case ("we've lost the Andheri hall"), and a location that hosts only
   * private slots had no control at all until these were pickable. */
  function toggleVenueSelection(ids: string[], seriesIds: string[], allOn: boolean) {
    const apply = (prev: Set<string>, xs: string[]) => {
      const next = new Set(prev);
      for (const id of xs) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    };
    setSelected((prev) => apply(prev, ids));
    setSelectedSeries((prev) => apply(prev, seriesIds));
  }

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
  // expanded, the rest collapse to a header + count. Desktop ignores this via
  // CSS (lg:block).
  //
  // This stores what is OPEN, not what has been "flipped from the default".
  // The old flag was read as `i === 0 ? !flipped : flipped`, so its meaning
  // inverted with the venue's position: filter down to a day only one venue
  // runs on and the venue he had just opened rendered closed, showing an empty
  // group that reads as "nothing on that day". Position now only supplies the
  // default for a venue he has never touched, re-evaluated on every filter
  // change rather than frozen at mount.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const toggleVenue = (key: string, isOpen: boolean) =>
    setOpenMap((prev) => ({ ...prev, [key]: !isOpen }));

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
      defaultValue: "all",
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
          maintenance bits. On the phone, Create is a FAB (below). In selection
          mode the same row becomes the select toolbar. */}
      {selecting ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-fg-2" aria-live="polite">
            {selectionCount} of {filteredTotal} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={selectAllFiltered}>
              {allSelected ? "Clear selection" : `Select all ${filteredTotal}`}
            </Button>
            <Button variant="ghost" onClick={exitSelect}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            aria-label="More options"
            onClick={() => setOverflowOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-line text-lg text-fg-2 hover:border-ember hover:text-ember"
          >
            ⋯
          </button>
          {filteredTotal > 0 && (
            <Button variant="ghost" onClick={() => setSelecting(true)}>
              Select
            </Button>
          )}
          {/* `hidden` alone cannot hide a Button: its base class list already
              carries `inline-flex`, and two display utilities of equal
              specificity leave source order to decide — which `inline-flex`
              won. So the phone showed "Create a class" AND the ＋ FAB below it,
              two controls doing one thing. Hiding a plain wrapper holds. */}
          <span className="hidden lg:inline-flex">
            <Button
              onClick={() => {
                setCreating(true);
                setMessage(null);
              }}
            >
              Create a class
            </Button>
          </span>
        </div>
      )}

      {classes.length + privateSeries.length > 0 && <FilterBar filters={filterDefs} />}

      {venueGroups.map((group, i) => {
        const key = group.venue || "no-venue";
        // First venue open by default, others collapsed; a tap flips it.
        // Untouched venues follow the default (first one open); once he taps a
        // venue, his choice sticks wherever it lands in the list.
        const open = openMap[key] ?? i === 0;
        const groupIds = group.days.flatMap((d) => d.rows.map((c) => c.id));
        const groupSeriesIds = group.days.flatMap((d) => d.privates.map((p) => p.id));
        const groupAllSelected =
          groupIds.length + groupSeriesIds.length > 0 &&
          groupIds.every((id) => selected.has(id)) &&
          groupSeriesIds.every((id) => selectedSeries.has(id));
        return (
        <div
          key={key}
          className="overflow-hidden rounded-[14px] border border-line bg-surface-2"
        >
          <div className="flex items-center border-b border-line">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggleVenue(key, open)}
            className="flex min-w-0 flex-1 items-baseline justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
          >
            <span className="flex items-baseline gap-2">
              <span
                className={`text-fg-2 transition-transform lg:rotate-90 ${open ? "rotate-90" : ""}`}
                aria-hidden
              >
                ›
              </span>
              <span className="font-semibold">{group.venue || "No venue"}</span>
              {/* A client's own home, not a venue we run. The same plum dot the
                  cards inside it use — the uppercase pill said it twice. */}
              {group.privateOnly && (
                <span
                  aria-label="Private location"
                  title="Private location"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-priv"
                />
              )}
            </span>
            <span className="shrink-0 text-sm text-fg-2">
              {group.classCount > 0 &&
                `${group.classCount} class${group.classCount === 1 ? "" : "es"}`}
              {group.classCount > 0 && group.privateCount > 0 && " · "}
              {group.privateCount > 0 && `${group.privateCount} private`}
            </span>
          </button>
          {selecting && groupIds.length + groupSeriesIds.length > 0 && (
            <button
              type="button"
              aria-label={`${groupAllSelected ? "Clear" : "Select"} everything at ${group.venue || "No venue"}`}
              onClick={() => toggleVenueSelection(groupIds, groupSeriesIds, groupAllSelected)}
              className="shrink-0 px-4 py-3 text-sm text-ember underline-offset-4 hover:underline"
            >
              {groupAllSelected ? "None" : "All"}
            </button>
          )}
          </div>
          <div className={`divide-y divide-line lg:block ${open ? "block" : "hidden"}`}>
            {group.days.map((day) => (
              <div key={day.weekday} className="px-4 py-3">
                {/* Every row on this screen repeats weekly, so this always has a
                    real weekday to print. It used to fall back to "One-off",
                    which could not happen and quietly implied the one-off
                    classes were somewhere on this list — they are not; the line
                    under the list says where they are instead. */}
                <p className="label mb-1.5">{WEEKDAY_NAME[day.weekday] ?? day.weekday}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {day.rows.map((c) => (
                    <WeeklyClassCard
                      key={c.id}
                      cls={c}
                      selecting={selecting}
                      selected={selected.has(c.id)}
                      onClick={() => {
                        if (selecting) {
                          toggleClass(c.id);
                          return;
                        }
                        setMessage(null);
                        setEditingClass(c);
                      }}
                      // Press and hold to start picking, with the held card
                      // already ticked — a hold that dropped him into an empty
                      // selection would make him aim at the same card twice.
                      onLongPress={() => {
                        setMessage(null);
                        setSelecting(true);
                        setSelected(new Set([c.id]));
                      }}
                    />
                  ))}
                  {day.privates.map((p) => (
                    <PrivateSeriesCard
                      key={p.id}
                      series={p}
                      selecting={selecting}
                      selected={selectedSeries.has(p.id)}
                      onClick={() => {
                        if (selecting) {
                          toggleSeries(p.id);
                          return;
                        }
                        // Only reached for a slot with no next session to
                        // deep-link to — the case that used to be a dead card.
                        setMessage(null);
                        setSelecting(true);
                        setSelectedSeries(new Set([p.id]));
                      }}
                      onLongPress={() => {
                        setMessage(null);
                        setSelecting(true);
                        setSelectedSeries(new Set([p.id]));
                      }}
                    />
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

      {/* This list is the repeating pattern, and the one-off classes genuinely
          aren't part of it — but they were being left out in silence, which is
          how two of them ended up with real attendance on them and no way off
          any screen the founder was looking at. Saying the number and pointing
          at the Schedule costs one line and ends the guessing. */}
      {oneOffCount > 0 && (
        <p className="px-1 text-sm text-fg-2">
          {oneOffCount} one-off {oneOffCount === 1 ? "class isn't" : "classes aren't"} on this
          list — {oneOffCount === 1 ? "it runs" : "they run"} on a date rather than every week.{" "}
          <Link href="/admin/schedule" className="text-ember hover:underline">
            Find {oneOffCount === 1 ? "it" : "them"} on the Schedule
          </Link>
          .
        </p>
      )}

      {/* Phone: Create a class as a floating button above the tab bar. It gives
          up the spot to the selection bar while selecting. */}
      {!selecting && (
        <Fab
          label="Create a class"
          onClick={() => {
            setCreating(true);
            setMessage(null);
          }}
        />
      )}

      {/* The selection's own action bar, in the same spot the toast uses so the
          count and the destructive button stay in reach on a phone. The toast
          stands down while it's here rather than landing on top of it. */}
      {selectionBarShowing && (
        <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 mx-auto flex max-w-md items-center gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3 shadow-[var(--shadow-sheet)] lg:bottom-6">
          {/* Counted apart, never merged into one number — "15 selected" over a
              mix of classes and families' standing slots hides which is which,
              and they are not the same kind of thing to lose. */}
          <span className="text-sm">
            {[
              selected.size > 0 &&
                `${selected.size} ${selected.size === 1 ? "class" : "classes"}`,
              selectedSeries.size > 0 &&
                `${selectedSeries.size} private ${selectedSeries.size === 1 ? "slot" : "slots"}`,
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            selected
          </span>
          <Button
            variant="destructive"
            className="ml-auto"
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        </div>
      )}

      {/* ⋯ overflow: the explainer + the rare "top up" maintenance action. */}
      <Sheet open={overflowOpen} onClose={() => setOverflowOpen(false)} title="Weekly classes">
        <div className="space-y-4">
          <p className="text-sm text-fg-2">
            Each class repeats every week and fills the Schedule tab. Tap one to change it —
            for a one-week-only change, tap that session in the Schedule tab instead.
          </p>
          {filteredTotal > 0 && (
            <div className="space-y-2 rounded-[12px] border border-line p-4">
              <p className="label">Clear the timetable</p>
              <p className="text-sm text-fg-2">
                Picks everything the filters are showing ({filteredTotal}) so you can start
                again. You get to see what goes quietly, what is still running, and what has
                people or history on it before anything happens — and you can unpick any of
                them first.
                {/* Say what it does NOT reach, rather than leaving him to find
                    out from a list that still has things on it. */}
                {oneOffCount > 0 && (
                  <>
                    {" "}
                    The {oneOffCount} one-off{" "}
                    {oneOffCount === 1 ? "class isn't" : "classes aren't"} on this list — clear
                    the whole calendar below for {oneOffCount === 1 ? "it" : "those"} too.
                  </>
                )}
              </p>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setSelecting(true);
                  setSelected(new Set(filteredIds));
                  setSelectedSeries(new Set(filteredSeriesIds));
                  setOverflowOpen(false);
                  setMessage(null);
                }}
              >
                Select all {filteredTotal}
              </Button>
            </div>
          )}
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

          {/* Set apart in red, below everything else and last in the tab order,
              because it is the only control here that ignores the filters and
              the selection entirely. Its own sheet does the actual guarding. */}
          <div className="space-y-2 rounded-[12px] border border-err p-4">
            <p className="label">Clear the whole calendar</p>
            <p className="text-sm text-fg-2">
              Everything, not just what this list shows — the one-off classes too, and every
              family&apos;s weekly private slot. You see exactly what it holds, and what each
              person gets back, before anything happens.
            </p>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setOverflowOpen(false);
                setMessage(null);
                setWiping(true);
              }}
            >
              Clear the whole calendar…
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Transient status line as a bottom toast — no reserved layout space.
          It sits exactly where the selection bar sits, so it stands down while
          that bar is up rather than landing on the Remove button he is reaching
          for. Nothing sets a message from inside selection mode, and everything
          that finishes a selection clears it in the same tick, so the line still
          arrives; it just waits until the bar has gone. */}
      {message && !selectionBarShowing && (
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

      {confirming && (
        <AdminBulkRemoveSheet
          classIds={selectedIds}
          seriesIds={selectedSeriesIds}
          onClose={() => setConfirming(false)}
          onDone={(m) => {
            setMessage(m);
            exitSelect();
            router.refresh();
          }}
        />
      )}

      {wiping && (
        <AdminWipeCalendarSheet
          onClose={() => setWiping(false)}
          onDone={(m) => {
            setMessage(m);
            setWiping(false);
            exitSelect();
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

