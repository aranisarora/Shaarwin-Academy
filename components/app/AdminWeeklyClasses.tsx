"use client";

// The Timetable view: every repeating class, grouped under the venue it runs
// at and then by day within that venue. Each venue is a card; under a day
// sub-heading the classes read coach · time. Tap a class to change it for every
// week; one-week-only changes happen on that session in This week.
//
// Nothing here reads class_sessions, which is what makes the two views of the
// Schedule tab safe to sit behind one switch: no amount of cancelling and
// moving can reach this list, so the standing pattern stays readable however
// messy the actual week gets.

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { wallDate } from "@/lib/academy-time";
import { Button } from "@/components/ui/Button";
import { FilterBar, type FilterDef } from "@/components/ui/FilterBar";
import { Fab } from "@/components/ui/Fab";
import { GroupCard } from "@/components/ui/GroupCard";
import { Sheet } from "@/components/ui/Sheet";
import { Toast, ToastSlot, useAutoClearMessage } from "@/components/ui/Toast";
import { topUpSessions } from "@/app/admin/schedule/actions";
import { WEEKDAY_ORDER } from "@/lib/group-by-day";
import { AdminClassSheet } from "./AdminClassSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import { CardActionMenu } from "./CardActionMenu";
import { PrivateSeriesSheet } from "./PrivateSeriesSheet";
import { time12h } from "./ClassFields";
import { AdminBulkRemoveSheet } from "./AdminBulkRemoveSheet";
import { AdminWipeCalendarSheet } from "./AdminWipeCalendarSheet";
import { PrivateSeriesCard, WeeklyClassCard } from "./ClassCard";
import type { OpenMap, ScheduleFilters } from "./AdminScheduleTabs";
import { KindIcon } from "./class-type";
import {
  WEEKDAY_NAME,
  type ClassRow,
  type ClientOption,
  type Coach,
  type InviteOption,
  type PrivateSeriesRow,
  type Venue,
} from "./admin-calendar-types";

/** Does a row that only knows its coach by NAME answer to the chosen coach ids?
 *
 *  Two things this settles that a bare `includes` would not. An empty list is
 *  "no filter", so everything passes. And a name the coaches list cannot resolve
 *  matches NOTHING — not even "No coach yet", which is the bucket for a slot
 *  nobody is staffing; a card printing a coach's name has no business in it.
 */
function coachMatches(
  coachName: string | null,
  chosen: string[],
  idByName: Map<string, string>
): boolean {
  if (chosen.length === 0) return true;
  if (!coachName) return chosen.includes("none");
  const id = idByName.get(coachName);
  return id !== undefined && chosen.includes(id);
}

export function AdminWeeklyClasses({
  classes,
  privateSeries = [],
  oneOffCount = 0,
  coaches,
  venues,
  clients,
  invites,
  filters,
  venueCards,
  openClassId = null,
  onRefresh,
  onShowThisWeek,
}: {
  classes: ClassRow[];
  // Active client weekly privates, grouped under the same locations as classes.
  privateSeries?: PrivateSeriesRow[];
  // Group classes that run on a date rather than every week, and so aren't on
  // this list at all. Only the count reaches here — see fetchTimetable.
  oneOffCount?: number;
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
  /** Coach / location / type / client, shared with This week. */
  filters: ScheduleFilters;
  /** Which venue cards are open, held above so it survives the view switch. */
  venueCards: OpenMap;
  // Deep-link from a session sheet ("edit the weekly class") — open this class
  // straight away so the two views feel like one thing.
  openClassId?: string | null;
  /** Re-fetch the timetable after a mutation. This data is no longer held by
   *  the server page — it is fetched on demand — so router.refresh() would
   *  reload the route without touching what this list is showing. */
  onRefresh?: () => void;
  /** Flip the tab to This week. The one-off classes genuinely live over there. */
  onShowThisWeek?: () => void;
}) {
  const router = useRouter();
  const [editingClass, setEditingClass] = useState<ClassRow | null>(
    () => classes.find((c) => c.id === openClassId) ?? null
  );
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useAutoClearMessage();
  const [clearOpen, setClearOpen] = useState(false);
  // The class a hold is currently offering actions for, and the class a
  // Duplicate is seeding the add sheet from.
  const [held, setHeld] = useState<ClassRow | null>(null);
  const [heldSeries, setHeldSeries] = useState<PrivateSeriesRow | null>(null);
  const [editingSeries, setEditingSeries] = useState<PrivateSeriesRow | null>(null);
  const [duplicating, setDuplicating] = useState<ClassRow | null>(null);
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
        if (r.ok) onRefresh?.();
      } catch {
        setMessage("Couldn't reach the server. Nothing changed — try again.");
      }
    });
  }

  // Filters — coach, location, type, client, then status. The first four are the
  // SAME four questions This week asks, in the same order and the same words,
  // and they come from above so flipping the switch keeps the answers. They used
  // to be different sets — this view had location/day/status, that one had
  // coach/venue/type — so the one axis both actually shared was called
  // "location" here and "venue" there, and two perfectly good questions ("what
  // does Ravi teach every week?", "show me just the privates") could not be
  // asked here at all.
  //
  // Status is the one extra, and it earns it: paused and ended are states only a
  // repeating class can be in, which is also why it stays local to this file.
  // Day is gone, for exactly the reason This week never had it — every card
  // already sits under a day heading.
  //
  // ALL FIVE take several answers at once, status included: "paused and ended"
  // is one question — everything he has stopped running — and one answer per
  // chip made him ask it twice and hold the two lists in his head. Empty means
  // no filter, everywhere, so none of them starts narrowed to anything.
  //
  // Five chips fit because the row scrolls sideways under a faded edge now. It
  // held five once while it still wrapped, and only 3.3 of them were ever
  // painted, so the founder never discovered the last one.
  //
  // Status in particular does NOT start on Active. It used to hide the ended and
  // paused ones, which sounds tidy until you follow what the founder actually
  // does: he ends a class, the class vanishes from the list, and the thing he
  // now wants to delete is somewhere he has to guess at — and "Select all 38"
  // was quietly only the active 38, so a timetable clear-out left the ended ones
  // behind. The cards already grey themselves out and say "Ended" or "Paused",
  // so nothing is lost by showing them, and Active is one tap away.
  const {
    coach: coachFilter,
    venue: venueFilter,
    type: typeFilter,
    client: clientFilter,
  } = filters;
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  // Location options are drawn from both classes and private series so a
  // location that only hosts a private slot still appears in the filter.
  const venueOptions = useMemo(
    () =>
      [
        ...new Set([
          ...classes.map((c) => c.venueName ?? ""),
          ...privateSeries.map((p) => p.venueName),
          // Whatever is filtered on stays listed even if nothing here matches
          // it — the filters are shared with This week now, so a location
          // chosen over there must still name itself over here. Every chosen
          // location, not just one: a value with no option to name it prints as
          // its own raw string in the chip summary, which for the "no location"
          // bucket is the empty string.
          ...venueFilter,
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [classes, privateSeries, venueFilter]
  );

  // Every client the academy has, not only the ones with something on this
  // list. Narrowing to a family and finding the Timetable empty is a real
  // answer ("they're only in the Sunday one-off"), and building the options
  // from the visible rows instead would delete the chip's own value the moment
  // it started filtering — leaving it lit in ember reading "All clients".
  const clientOptions = useMemo(
    () =>
      clients
        .map((c) => ({ value: c.id, label: c.name || "Unnamed client" }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clients]
  );

  // Matched by name, not id: a class carries its next session's coach name and a
  // private series carries its preferred coach's name, and neither carries an id
  // the other also has. The name is the only key both rows share.
  // The filter carries coach IDs, exactly as This week's does — one chip drives
  // both views, so both must speak the same values. A class row only carries its
  // coach's NAME (the timetable query resolves it and never brings the id
  // along), so the name is mapped back here rather than the filter being allowed
  // to mean two different things on two halves of one switch.
  const coachIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of coaches) m.set(c.name, c.id);
    return m;
  }, [coaches]);

  const filteredClasses = useMemo(
    () =>
      classes.filter((c) => {
        if (!coachMatches(c.coachName, coachFilter, coachIdByName)) return false;
        if (venueFilter.length > 0 && !venueFilter.includes(c.venueName ?? "")) return false;
        // A repeating group class is never a private, so asking for privates
        // alone empties this half of the list on purpose — the standing slots
        // below are the whole answer to that question.
        if (typeFilter.length > 0 && !typeFilter.includes(c.isSchool ? "school" : "group"))
          return false;
        // Ended and paused are both "not active" and only the end date tells
        // them apart, which is why this is read once rather than asked as three
        // separate conditions that can drift out of agreement.
        const status = c.active ? "active" : c.endsOn ? "ended" : "paused";
        if (statusFilter.length > 0 && !statusFilter.includes(status)) return false;
        // A group class is a family's when any of the regulars on its next
        // session is theirs. That roster is the only connection this row has to
        // a client, so a class with an empty one drops out of every client
        // filter — which is right: nobody has told us they are in it.
        if (clientFilter.length > 0 && !c.clientIds.some((id) => clientFilter.includes(id)))
          return false;
        return true;
      }),
    [classes, coachIdByName, coachFilter, venueFilter, typeFilter, statusFilter, clientFilter]
  );

  const filteredPrivates = useMemo(
    () =>
      privateSeries.filter((p) => {
        if (!coachMatches(p.coachName, coachFilter, coachIdByName)) return false;
        if (venueFilter.length > 0 && !venueFilter.includes(p.venueName)) return false;
        if (typeFilter.length > 0 && !typeFilter.includes("private")) return false;
        // Private series are always active — the page only queries active ones —
        // so asking for paused or ended alone is asking for a state no row on
        // this half of the list can be in.
        if (statusFilter.length > 0 && !statusFilter.includes("active")) return false;
        // An open slot with no family on it yet has no client to match, so it
        // falls out the moment he narrows to one.
        if (clientFilter.length > 0 && (!p.clientId || !clientFilter.includes(p.clientId)))
          return false;
        return true;
      }),
    [
      privateSeries,
      coachIdByName,
      coachFilter,
      venueFilter,
      typeFilter,
      statusFilter,
      clientFilter,
    ]
  );

  // "Select all" means everything the filters are currently showing — so
  // narrowing to two locations, or to one family, makes it a targeted clear, and
  // leaving every chip empty makes it the full reset of this screen. It now
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
  // inverted with the venue's position: narrow to a coach only one venue books
  // and the venue he had just opened rendered closed, showing an empty group
  // that reads as "nothing there". Position now only supplies the default for a
  // venue he has never touched, re-evaluated on every filter change rather than
  // frozen at mount.
  //
  // Everything starts OPEN, which is the same promise This week makes about its
  // days. It used to open only the first venue, so the two views of one tab
  // disagreed about whether arriving somewhere means seeing what is there:
  // flipping to the Timetable showed one venue and five grey bars, and finding
  // out what was on at the other five cost a tap each. Collapsing is still
  // there for tidying a long list — it is just no longer the arrival state.
  // Held above, alongside This week's day cards, so the switch stops throwing
  // away which cards the founder had opened.
  const openMap = venueCards.map;
  const toggleVenue = venueCards.toggle;

  // Same four as This week, same order, same words — then the one extra that
  // only makes sense here. Every inactive chip reads "All …"; this row used to
  // say "Any day" and "Any status" beside "All locations", which is two
  // grammars for one idea.
  //
  // None of them lists an "All …" option of its own: FilterBar renders that row
  // itself, from `label`, and clearing is what it does. Handed in as a real
  // option it would be tickable alongside three coaches, and the chip would have
  // to answer "all, and these three?".
  const filterDefs: FilterDef[] = [
    {
      key: "coach",
      aria: "Filter by coach",
      label: "All coaches",
      mode: "multi",
      values: coachFilter,
      onChange: filters.setCoach,
      options: [
        { value: "none", label: "No coach yet" },
        ...coaches.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      key: "venue",
      aria: "Filter by location",
      label: "All locations",
      mode: "multi",
      values: venueFilter,
      onChange: filters.setVenue,
      options: venueOptions.map((v) => ({ value: v, label: v || "No location" })),
    },
    {
      key: "type",
      aria: "Filter by class type",
      label: "All types",
      mode: "multi",
      values: typeFilter,
      onChange: filters.setType,
      options: [
        { value: "group", label: "Group" },
        { value: "private", label: "Private" },
        { value: "school", label: "School" },
      ],
    },
    {
      // "Which of this is the Sharma family's?" — a question the Timetable could
      // not answer at all until a class started carrying the regulars on its
      // next session. It reaches group classes and standing private slots alike,
      // so the answer is the family's whole week here, not just their privates.
      key: "client",
      aria: "Filter by client",
      label: "All clients",
      mode: "multi",
      values: clientFilter,
      onChange: filters.setClient,
      options: clientOptions,
    },
    {
      key: "status",
      aria: "Filter by status",
      label: "All statuses",
      mode: "multi",
      values: statusFilter,
      onChange: setStatusFilter,
      options: [
        { value: "active", label: "Active" },
        { value: "paused", label: "Paused" },
        { value: "ended", label: "Ended" },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {/* Two controls, and both say what they do. There used to be a third — an
          unlabelled ⋯ — and it held the one thing on this screen there is no
          undo for. It also held a second way to start a selection, so "clear
          some classes" had two doors and "clear the whole calendar" had none
          you could see. One door now: Clear opens the hub, the hub owns every
          way of clearing. On the phone, Create is a FAB (below). In selection
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
          {classes.length + privateSeries.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                setMessage(null);
                setClearOpen(true);
              }}
            >
              Clear…
            </Button>
          )}
          {/* `hidden` alone cannot hide a Button: its base class list already
              carries `inline-flex`, and two display utilities of equal
              specificity leave source order to decide — which `inline-flex`
              won. So the phone showed "Create a class" AND the ＋ FAB below it,
              two controls doing one thing. Hiding a plain wrapper holds. */}
          <span className="hidden lg:inline-flex">
            {/* "Add a class", the same three words This week uses and the same
                three the sheet is now titled with. It said "Create a class"
                here, "Add a class" there and "New class" on the sheet all three
                opened — one door with three names. */}
            <Button
              onClick={() => {
                setCreating(true);
                setMessage(null);
              }}
            >
              Add a class
            </Button>
          </span>
        </div>
      )}

      {classes.length + privateSeries.length > 0 && <FilterBar filters={filterDefs} />}

      {venueGroups.map((group) => {
        const key = group.venue || "no-venue";
        // Open unless he has closed it. Position no longer decides anything —
        // it used to, and narrowing until only one venue had rows could render
        // the venue he had just opened as closed.
        const open = openMap[key] ?? true;
        const groupIds = group.days.flatMap((d) => d.rows.map((c) => c.id));
        const groupSeriesIds = group.days.flatMap((d) => d.privates.map((p) => p.id));
        const groupAllSelected =
          groupIds.length + groupSeriesIds.length > 0 &&
          groupIds.every((id) => selected.has(id)) &&
          groupSeriesIds.every((id) => selectedSeries.has(id));
        return (
        <GroupCard
          key={key}
          collapsible
          open={open}
          onToggle={() => toggleVenue(key, open)}
          title={
            <>
              {/* "No location" — the same words the filter beside it uses.
                  The header said "No venue" and the filter said "No location"
                  for the same bucket, inside one view. */}
              <span className="font-semibold">{group.venue || "No location"}</span>
              {/* A client's own home, not a venue we run. The same plum glyph
                  the cards inside it carry — it was a hand-rolled plum dot, and
                  the moment the cards moved from a dot to a shape this header
                  was the one place still speaking the old language. It comes
                  from class-type.tsx now, so it cannot fall behind again. */}
              {group.privateOnly && (
                <span aria-label="Private location" title="Private location" className="self-center">
                  <KindIcon kind="private" className="text-priv" />
                </span>
              )}
            </>
          }
          meta={
            <>
              {group.classCount > 0 &&
                `${group.classCount} class${group.classCount === 1 ? "" : "es"}`}
              {group.classCount > 0 && group.privateCount > 0 && " · "}
              {group.privateCount > 0 && `${group.privateCount} private`}
            </>
          }
          headerAction={
            selecting && groupIds.length + groupSeriesIds.length > 0 ? (
              <button
                type="button"
                aria-label={`${groupAllSelected ? "Clear" : "Select"} everything at ${group.venue || "No location"}`}
                onClick={() => toggleVenueSelection(groupIds, groupSeriesIds, groupAllSelected)}
                className="shrink-0 px-4 py-3 text-sm text-ember underline-offset-4 hover:underline"
              >
                {groupAllSelected ? "None" : "All"}
              </button>
            ) : undefined
          }
        >
          <div className="divide-y divide-line">
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
                      // Press and hold asks what he wants, rather than assuming
                      // he meant to start a selection. Selection is still one
                      // tap away in that menu, and still arrives with this card
                      // already ticked — a hold that dropped him into an empty
                      // selection would make him aim at the same card twice.
                      onLongPress={() => {
                        setMessage(null);
                        setHeld(c);
                      }}
                    />
                  ))}
                  {day.privates.map((p) => (
                    <PrivateSeriesCard
                      key={p.id}
                      series={p}
                      selecting={selecting}
                      selected={selectedSeries.has(p.id)}
                      // Tap edits, hold offers the menu — exactly as a class
                      // beside it does. Tapping used to navigate silently to a
                      // session on the other view when the slot had one, and
                      // drop you into a selection when it didn't, so the same
                      // tap on two cards in one grid did two different things
                      // depending on data neither card showed.
                      onClick={() => {
                        if (selecting) {
                          toggleSeries(p.id);
                          return;
                        }
                        setMessage(null);
                        setEditingSeries(p);
                      }}
                      onLongPress={() => {
                        setMessage(null);
                        setHeldSeries(p);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </GroupCard>
        );
      })}
      {classes.length + privateSeries.length === 0 && (
        <div className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          <p className="font-medium text-fg">Add each class you run — day, time, place.</p>
          <p className="mt-1">
            We&apos;ll build the weekly schedule and handle bookings, reminders and
            reschedules from there. Tap &ldquo;Add a class&rdquo; to start.
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
          at This week costs one line and ends the guessing.
          It is a button rather than a link now: both views live in this one tab,
          so "go and look" is a switch, not a page load. */}
      {oneOffCount > 0 && (
        <p className="px-1 text-sm text-fg-2">
          {oneOffCount} one-off {oneOffCount === 1 ? "class isn't" : "classes aren't"} on this
          list — {oneOffCount === 1 ? "it runs" : "they run"} on a date rather than every week.{" "}
          <button
            type="button"
            onClick={onShowThisWeek}
            className="text-ember underline-offset-4 hover:underline"
          >
            Find {oneOffCount === 1 ? "it" : "them"} in This week
          </button>
          .
        </p>
      )}

      {/* Maintenance, not clearing — so it does not belong in the Clear hub, and
          it was the only other thing the ⋯ held. A quiet line in the flow of the
          page is more findable than an unlabelled glyph, and it says up front
          that he almost certainly doesn't need it. */}
      {/* This used to assert "Sessions top up automatically each night." Only
          two cron jobs exist — private-series-nightly (0024) and
          session-status-hourly (0065). The line that would schedule
          generate_class_sessions was written as a COMMENT in migration 0006
          and never run, so on the migration history nothing tops these up at
          all and the sentence was telling the founder not to worry about the
          one thing keeping his timetable from running out. Claiming no
          schedule would be its own guess — the live database has drifted ahead
          of these files — so it now says what the button does, which is true
          either way. */}
      {classes.length > 0 && (
        <p className="px-1 text-sm text-fg-2">
          Runs out to 8 weeks ahead. Topping up only ever adds the weeks that are
          missing, so it is always safe to tap.{" "}
          <button
            type="button"
            disabled={pending}
            onClick={topUp}
            className="text-ember underline-offset-4 hover:underline disabled:opacity-60"
          >
            {pending ? "Topping up…" : "Top up now"}
          </button>
        </p>
      )}

      {/* Phone: Add a class as a floating button above the tab bar. It gives
          up the spot to the selection bar while selecting. */}
      {!selecting && (
        <Fab
          label="Add a class"
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
        <ToastSlot className="flex items-center gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3 shadow-[var(--shadow-sheet)]">
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
        </ToastSlot>
      )}

      {/* The Clear hub — every way of clearing this calendar, in the order the
          founder needs them: the filtered list first because it is the everyday
          job, the whole calendar last and alone in red because it is the one
          with no undo. Nothing else lives here; a menu that also held a tutorial
          and a maintenance button is what made the last one unfindable. */}
      <Sheet open={clearOpen} onClose={() => setClearOpen(false)} title="Clear classes">
        <div className="space-y-4">
          {filteredTotal > 0 && (
            <div className="space-y-2 rounded-[12px] border border-line p-4">
              <p className="label">Clear this list</p>
              <p className="text-sm text-fg-2">
                {/* Counted apart whenever both kinds are here, for the same
                    reason the selection bar counts them apart: a class and a
                    family's standing slot are not the same thing to lose. */}
                {filteredSeriesIds.length > 0 ? (
                  <>
                    {filteredIds.length}{" "}
                    {filteredIds.length === 1 ? "class" : "classes"} and{" "}
                    {filteredSeriesIds.length} private{" "}
                    {filteredSeriesIds.length === 1 ? "slot" : "slots"} are showing.
                  </>
                ) : (
                  <>
                    {filteredTotal} {filteredTotal === 1 ? "class is" : "classes are"} showing.
                  </>
                )}{" "}
                Narrow with the filters first to clear one location, or everything a coach
                has ended. You see what each one costs before anything happens, and you can
                unpick any of them.
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
              <div className="flex flex-wrap gap-2">
                {/* Straight to the decision, with everything ticked. Closing
                    that sheet leaves him here in selection mode with the ticks
                    intact, so "all but three" is still two taps away. */}
                <Button
                  variant="ghost"
                  className="min-w-fit flex-1 basis-40"
                  onClick={() => {
                    setSelecting(true);
                    setSelected(new Set(filteredIds));
                    setSelectedSeries(new Set(filteredSeriesIds));
                    setClearOpen(false);
                    setMessage(null);
                    setConfirming(true);
                  }}
                >
                  Clear all {filteredTotal}
                </Button>
                <Button
                  variant="ghost"
                  className="min-w-fit flex-1 basis-40"
                  onClick={() => {
                    setSelecting(true);
                    setSelected(new Set());
                    setSelectedSeries(new Set());
                    setClearOpen(false);
                    setMessage(null);
                  }}
                >
                  Pick some…
                </Button>
              </div>
            </div>
          )}

          {/* Set apart in red, below everything else and last in the tab order,
              because it is the only control here that ignores the filters and
              the selection entirely. Its own sheet does the actual guarding. */}
          <div className="space-y-2 rounded-[12px] border border-err p-4">
            <p className="label">The whole calendar</p>
            <p className="text-sm text-fg-2">
              Everything, not just what this list shows — the one-off classes too, and every
              family&apos;s weekly private slot. You see exactly what it holds, and what each
              person gets back, before anything happens.
            </p>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setClearOpen(false);
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
      {message && !selectionBarShowing && <Toast>{message}</Toast>}

      <CardActionMenu
        open={!!held}
        title={
          held
            ? `${WEEKDAY_NAME[held.weekday] ?? held.weekday} ${time12h(held.time)}${held.venueName ? ` · ${held.venueName}` : ""}`
            : ""
        }
        onClose={() => setHeld(null)}
        actions={
          held
            ? [
                {
                  // "Open", the same word This week uses for the same gesture on
                  // the same-looking card. The hint is where the two differ, and
                  // it is the difference that matters.
                  label: "Open",
                  hint: "Changes every week from now on",
                  onSelect: () => setEditingClass(held),
                },
                {
                  label: "Duplicate",
                  hint: "Same location, coach, length and spots — pick a new day",
                  onSelect: () => setDuplicating(held),
                },
                {
                  label: "Select",
                  hint: "Pick several to remove together",
                  onSelect: () => {
                    setSelecting(true);
                    setSelected(new Set([held.id]));
                    // Clear the OTHER kind. Each menu used to set only its own
                    // set, so starting a class selection could carry a family's
                    // standing slot in with it from an earlier, abandoned one.
                    setSelectedSeries(new Set());
                  },
                },
              ]
            : []
        }
      />

      {/* A family's standing slot gets the same menu as the class beside it —
          the same things, in the same order, with the same words.
          Ending the slot is NOT here any more. It was the only destructive item
          in either menu, on the card whose neighbour had none, reached by a
          450ms hold that nothing on the card advertised. It lives in the slot's
          own editor now, under More, exactly where a class keeps its endings. */}
      <CardActionMenu
        open={!!heldSeries}
        title={
          heldSeries
            ? `${heldSeries.playerName} · ${WEEKDAY_NAME[heldSeries.weekday] ?? heldSeries.weekday} ${time12h(heldSeries.time)}`
            : ""
        }
        onClose={() => setHeldSeries(null)}
        actions={
          heldSeries
            ? [
                {
                  label: "Open",
                  hint: "Moves every booked week with it",
                  onSelect: () => setEditingSeries(heldSeries),
                },
                ...(heldSeries.nextSessionId && heldSeries.nextSessionStart
                  ? [
                      {
                        label: "Open this week's session",
                        hint: "Change one week only, without moving the slot",
                        onSelect: () => {
                          const s = heldSeries;
                          router.push(
                            `/admin/schedule?date=${wallDate(s.nextSessionStart!)}&session=${s.nextSessionId}`
                          );
                        },
                      },
                    ]
                  : []),
                {
                  label: "Select",
                  hint: "Pick several to end together",
                  onSelect: () => {
                    setSelecting(true);
                    setSelectedSeries(new Set([heldSeries.id]));
                    setSelected(new Set());
                  },
                },
              ]
            : []
        }
      />

      {editingSeries && (
        <PrivateSeriesSheet
          key={editingSeries.id}
          series={editingSeries}
          coaches={coaches}
          onClose={() => setEditingSeries(null)}
          onDone={(m) => {
            setMessage(m);
            setEditingSeries(null);
            onRefresh?.();
          }}
          // The confirm sheet lives here because it is the same one the bulk
          // path uses — it names what the family gets back before anything
          // happens, and there is no reason to have two of those.
          onEnd={() => {
            setSelected(new Set());
            setSelectedSeries(new Set([editingSeries.id]));
            setEditingSeries(null);
            setConfirming(true);
          }}
        />
      )}

      {duplicating && (
        <AdminAddSheet
          // Seeded with the setup and nothing else. The slot is the one part he
          // is duplicating IN ORDER to change, so leaving it filled in would
          // hand him a clash to clear before he could start.
          defaultRepeat="weekly"
          seed={{
            mode: duplicating.isSchool ? "school" : "weekly",
            venueId: duplicating.venueId,
            capacity: duplicating.capacity,
            durationMinutes: duplicating.duration,
          }}
          onClose={() => setDuplicating(null)}
          onDone={(m) => {
            setMessage(m);
            setDuplicating(null);
            onRefresh?.();
          }}
          coaches={coaches}
          venues={venues}
          clients={clients}
          invites={invites}
        />
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
            onRefresh?.();
          }}
        />
      )}

      {confirming && (
        <AdminBulkRemoveSheet
          classIds={selectedIds}
          seriesIds={selectedSeriesIds}
          // Backing out of a confirm that was opened OUTSIDE selection mode has
          // to drop what it was holding. It didn't: the ticks survived, the
          // selection bar stayed hidden because `selecting` was false, and the
          // next selection he started silently carried that family's slot into
          // it — with the only evidence being a count string.
          onClose={() => {
            setConfirming(false);
            if (!selecting) {
              setSelected(new Set());
              setSelectedSeries(new Set());
            }
          }}
          onDone={(m) => {
            setMessage(m);
            exitSelect();
            onRefresh?.();
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
            onRefresh?.();
          }}
        />
      )}

      {creating && (
        <AdminAddSheet
          defaultRepeat="weekly"
          onClose={() => setCreating(false)}
          onDone={(m) => {
            setMessage(m);
            setCreating(false);
            onRefresh?.();
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

