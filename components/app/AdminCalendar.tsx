"use client";

// This week: the session instances, day by day. Tap one to change it — "just
// this session" or "every week", Google Calendar-style. The repeating classes
// that generate these live one tap away on the Timetable view; here you only
// add one-offs.
//
// Cancelled sessions are shown. They used not to be fetched at all, so a
// called-off class simply left a hole and the founder could not tell a day we
// don't run from a day that fell through — the single thing that made this
// screen untrustworthy enough to need a second one beside it. They do not go
// back in the main flow, though: they sit behind one quiet line under their own
// day, because a dead card between two live ones is noise on every normal week
// bought to gain clarity on the rare bad one. That fold is the DEFAULT view's
// noise control and nothing more: filter by status and it comes off, because
// folding away the very thing he has just asked for by name is not tidying up,
// it is the screen ignoring him.
//
// The filters and the day-open state are NOT held here any more. Coach,
// location, type and client are the same four questions the Timetable asks, and
// a founder who narrows to one coach and flips the switch should still be
// looking at that coach. See AdminScheduleTabs.
//
// The status filter is the one exception, and it lives here. The Timetable's
// status question is active / paused / ended — whether a class is still
// something we run at all — which is a different question about different rows
// from whether one dated session happened. Sharing a chip between the two would
// leave one control meaning two things depending on which side of the switch
// the founder was standing on.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FilterBar, type FilterDef } from "@/components/ui/FilterBar";
import { Fab } from "@/components/ui/Fab";
import { GroupCard } from "@/components/ui/GroupCard";
import { ToastSlot, useAutoClearMessage } from "@/components/ui/Toast";
import { ActionResult } from "./ActionResult";
import { AdminSessionSheet } from "./AdminSessionSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import { CardActionMenu } from "./CardActionMenu";
import { DayHeading } from "./DayHeading";
import { SessionCard } from "./ClassCard";
import { groupSessionsByDay } from "@/lib/group-by-day";
import { formatClock, sessionTimeStatus, wallDate } from "@/lib/academy-time";
import { venueKeyOf } from "@/lib/venue-display";
import type { OpenMap, ScheduleFilters } from "./AdminScheduleTabs";
import { KIND_WORD, classKind } from "./class-type";
import {
  type ClientOption,
  type Coach,
  type InviteOption,
  type SessionRow,
  type Venue,
} from "./admin-calendar-types";

/** Clears the sticky header — the toggle plus the week strip — so a day the
 *  strip jumps to lands under it rather than behind it. The height is measured
 *  by AdminScheduleTabs and handed down as --sticky-h; it was a hardcoded 10rem
 *  against a stack over 200px tall, which hid the whole day heading.
 *
 *  An inline style rather than an arbitrary Tailwind class: this has to resolve
 *  against a variable set at runtime, and a class that silently fails to
 *  generate would put the bug straight back. */
const DAY_SCROLL_MARGIN: React.CSSProperties = {
  scrollMarginTop: "calc(var(--header-h) + var(--sticky-h, 10rem) + 0.5rem)",
};

/** Which of the three status words a session answers to.
 *
 *  Deliberately not `s.status` on its own. That column is settled by an HOURLY
 *  cron (sweep_session_status, migration 0065) while the card greys itself off
 *  the clock the moment the class ends — so between a 7pm finish and the 8:05
 *  sweep the row still reads 'scheduled'. Filtering on the raw column there
 *  would drop a card that is sitting on screen in finished grey, and hand back
 *  a class that is already over under a chip promising it is still on. He is
 *  filtering by what he can see, so the filter reads what he can see. */
function statusOf(s: SessionRow): SessionRow["status"] {
  if (s.status !== "scheduled") return s.status;
  return sessionTimeStatus(s.starts_at, s.ends_at) === "completed"
    ? "completed"
    : "scheduled";
}

/** The cancellations for one day, folded into a line. Collapsed by default:
 *  the count is the fact he needs while scanning, the reason the fact he needs
 *  only once he has stopped.
 *
 *  `fold={false}` lays them out flat with no disclosure at all — see the status
 *  filter below, where he has asked for the cancelled ones by name and a count
 *  he has to tap is one step too many. */
function CancelledLine({
  rows,
  onOpen,
  coachNameOf,
  fold = true,
}: {
  rows: SessionRow[];
  onOpen: (s: SessionRow) => void;
  coachNameOf: (s: SessionRow) => string | null;
  fold?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="col-span-full">
      {fold && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="pressable flex min-h-11 w-full items-center gap-1.5 rounded-[8px] px-1 text-left text-sm text-fg-2 hover:text-ember"
        >
          <span aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`}>
            ›
          </span>
          {rows.length} cancelled
        </button>
      )}
      {(open || !fold) && (
        <div
          className={`grid gap-2 sm:grid-cols-2 lg:grid-cols-3 ${fold ? "mt-2" : ""}`}
        >
          {rows.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              showDay
              coachName={coachNameOf(s)}
              onClick={() => onOpen(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminCalendar({
  sessions,
  coaches,
  venues,
  clients,
  invites,
  filters,
  days,
  onRefresh,
  openSessionId = null,
}: {
  sessions: SessionRow[];
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
  /** Coach / location / type / client, shared with the Timetable view. */
  filters: ScheduleFilters;
  /** Which day cards are open, shared with the week strip above. */
  days: OpenMap;
  onRefresh?: () => void;
  /** Deep-link from a notification or the Timetable — open this session. */
  openSessionId?: string | null;
}) {
  const [selected, setSelected] = useState<SessionRow | null>(
    () => sessions.find((s) => s.id === openSessionId) ?? null
  );
  // Which panel the sheet opens on — "cancel" lands on the scope question
  // rather than the editor, for the Cancel row in the hold menu.
  const [openAt, setOpenAt] = useState<"edit" | "cancel">("edit");
  // The session a hold is offering actions for, and the one a Duplicate is
  // seeding the add sheet from.
  const [held, setHeld] = useState<SessionRow | null>(null);
  const [duplicating, setDuplicating] = useState<SessionRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useAutoClearMessage();

  const {
    coach: coachFilter,
    venue: venueFilter,
    type: typeFilter,
    client: clientFilter,
  } = filters;

  // Held here rather than in ScheduleFilters, and the note at the top of the
  // file says why: the Timetable's status axis is a different question.
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  // Drawn from this week's sessions, PLUS whatever is currently filtered on.
  // Without that last part, paging to a week where the chosen hall has nothing
  // dropped its option — so the chip fell back to reading "All locations"
  // while still filtering, in ember, with an ✕. It looked cleared and wasn't.
  // Now that the filter holds several halls at once, every one of them has to
  // survive that week, not just the one.
  //
  // Keyed on the venue rather than the full label, so this list and the
  // Timetable's are the same list and one chip can drive both. See venueKeyOf.
  const venueOptions = useMemo(
    () =>
      [
        ...new Set([
          ...sessions.map((s) => venueKeyOf(s.venueName)).filter(Boolean),
          ...venueFilter,
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [sessions, venueFilter]
  );

  // Every client the academy has, not the ones with a session this week — the
  // same reasoning as the venue list above, arrived at from the other side. A
  // family whose week turns out to be empty would lose its option while still
  // filtering, leaving a chip that reads "All clients" over a screen with
  // nothing on it.
  //
  // Sorted here as well as in the query, because this is the one list on the
  // page that runs to hundreds and he opens it already knowing the name he
  // wants: the fallback below renames the nameless ones, and a row that sorted
  // by an empty full_name lands somewhere he would never look for it.
  const clientOptions = useMemo(
    () =>
      clients
        .map((c) => ({ value: c.id, label: c.name || "Unnamed client" }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clients]
  );

  // Empty list = no filter on that axis; otherwise the session has to match one
  // of the chosen values. Several answers at once is the whole point of the
  // change — "Ravi and Amit are both out on Friday" used to be two passes over
  // the same week, with the founder holding the first one in his head.
  const filtered = useMemo(
    () =>
      sessions.filter((s) => {
        // "none" is a real answer here, not a sentinel meaning "off": picking it
        // beside Ravi asks for the unassigned sessions AND Ravi's, which is
        // exactly what somebody rostering a Friday wants in front of him.
        if (coachFilter.length > 0 && !coachFilter.includes(s.coachId ?? "none"))
          return false;
        if (venueFilter.length > 0 && !venueFilter.includes(venueKeyOf(s.venueName)))
          return false;
        // classKind rather than re-reading isPrivate/isSchool here: it is the
        // same function the card's glyph and word come from, so the chip and the
        // cards it filters down to cannot drift apart later.
        if (typeFilter.length > 0 && !typeFilter.includes(classKind(s))) return false;
        // ANY of the chosen families, not all of them. A group class the Sharmas
        // and the Raos are both in belongs in either family's answer.
        if (
          clientFilter.length > 0 &&
          !s.clientIds.some((id) => clientFilter.includes(id))
        )
          return false;
        if (statusFilter.length > 0 && !statusFilter.includes(statusOf(s))) return false;
        return true;
      }),
    [sessions, coachFilter, venueFilter, typeFilter, clientFilter, statusFilter]
  );

  // Asking by status is asking to see them, so the cancelled line stops folding
  // and the cancelled sessions take their place in the day grids. See the note
  // at the top of the file.
  const foldCancelled = statusFilter.length === 0;

  // The coach lanes below read `live`, whether or not the fold is on. A
  // cancelled session needs no coach, so it raises no alarm, fills no lane, and
  // counts towards nothing that is "on" — filtering to it changes where it is
  // drawn, not whose working week it belongs to.
  const live = useMemo(() => filtered.filter((s) => s.status !== "cancelled"), [filtered]);
  const cancelled = useMemo(
    () => filtered.filter((s) => s.status === "cancelled"),
    [filtered]
  );

  const lanes = useMemo(() => {
    const unassigned = live.filter((s) => !s.coachId);
    const byCoach = coaches.map((coach) => ({
      coach,
      rows: live.filter((s) => s.coachId === coach.id),
    }));
    return { unassigned, byCoach };
  }, [live, coaches]);

  const today = wallDate(new Date().toISOString());
  // Every axis, or the line under the lanes lies. "No sessions this week: Ravi"
  // is a fact about the week; under any narrowing at all it would really mean
  // "none that match", which is not what it says and not what he would read.
  const filtersActive =
    coachFilter.length > 0 ||
    venueFilter.length > 0 ||
    typeFilter.length > 0 ||
    clientFilter.length > 0 ||
    statusFilter.length > 0;
  const emptyCoaches = filtersActive
    ? []
    : lanes.byCoach.filter(({ rows }) => rows.length === 0).map(({ coach }) => coach);

  const coachNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of coaches) m.set(c.id, c.name);
    return m;
  }, [coaches]);
  const coachNameOf = (s: SessionRow) =>
    s.coachId ? (coachNameById.get(s.coachId) ?? null) : null;

  const openSession = (session: SessionRow, at: "edit" | "cancel" = "edit") => {
    setMessage(null);
    setOpenAt(at);
    setSelected(session);
  };

  // None of these carry an "all" option any more. FilterBar draws that row
  // itself from `label`, and handing one in as a value would let "All coaches"
  // be ticked alongside two named ones — a filter claiming both at once.
  const filterDefs: FilterDef[] = [
    {
      key: "coach",
      aria: "Filter by coach",
      label: "All coaches",
      mode: "multi",
      values: coachFilter,
      onChange: filters.setCoach,
      // "No coach yet" survives the move and is not the absent "all" in
      // disguise: it names a set of real sessions, and it combines with the
      // named coaches like any other choice.
      options: [
        { value: "none", label: "No coach yet" },
        ...coaches.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      // "Location", not "venue" — the same word the Timetable uses, the same
      // word the editors use now, and the same word the cards use. Half of what
      // it lists are families' own homes, which are locations and are not
      // venues; calling it venue anywhere made one axis look like two.
      key: "venue",
      aria: "Filter by location",
      label: "All locations",
      mode: "multi",
      values: venueFilter,
      onChange: filters.setVenue,
      options: venueOptions.map((v) => ({ value: v, label: v })),
    },
    {
      key: "type",
      aria: "Filter by class type",
      label: "All types",
      mode: "multi",
      values: typeFilter,
      onChange: filters.setType,
      // The app's one set of names for the three kinds — the chips used to say
      // "Group / Private / School" while the cards below them said "Group class
      // / Private / School class" and the Add sheet said a third thing again.
      // Filtering to a word you cannot then find on a card is a small betrayal
      // that costs a scroll every time.
      options: [
        { value: "group", label: KIND_WORD.group },
        { value: "private", label: KIND_WORD.private },
        { value: "school", label: KIND_WORD.school },
      ],
    },
    {
      // The family, not the child. The founder's question is "what is the
      // Sharma family in this week?" and it is asked of the account that pays,
      // so one pick catches both children and the group classes as well as the
      // privates — see SessionRow.clientIds.
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
      // He asked for "cancelled, completed, live etc", and two of those three
      // words are kept exactly. "Live" is not: the card spends that word on the
      // ember badge for a class happening RIGHT NOW, so a chip reading Live
      // over forty upcoming sessions would be the same betrayal the type
      // options above are commented for. "Still on" is what he means by it —
      // not called off, not yet finished — and no card contradicts it.
      options: [
        { value: "scheduled", label: "Still on" },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
  ];

  // Day-first for the phone. Days come from every session including the
  // cancelled ones, so a day whose only class was called off still appears —
  // saying so is the entire point.
  const dayGroups = useMemo(() => groupSessionsByDay(filtered, today), [filtered, today]);

  const addButton = (
    <Button
      onClick={() => {
        setAdding(true);
        setMessage(null);
      }}
    >
      Add a class
    </Button>
  );

  return (
    <div className="space-y-5">
      {/* Desktop keeps the inline "Add" button; the phone gets a FAB (below). */}
      <div className="hidden justify-end lg:flex">{addButton}</div>

      {sessions.length > 0 && <FilterBar filters={filterDefs} />}

      {/* An empty week used to render nothing whatsoever — the filter row is
          gated on having sessions, the "no match" line too, and a week with no
          rows produces no day cards. So a founder who paged forward two weeks
          got a blank screen and no way to tell "nothing on" from "didn't
          load". The Timetable had a proper empty state all along. */}
      {sessions.length === 0 && (
        <div className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          <p className="font-medium text-fg">Nothing on this week.</p>
          <p className="mt-1">
            Classes that repeat show up here automatically once they&apos;re on the
            Timetable. Use ＋ to put on a one-off — a make-up session, or a hall that
            came free.
          </p>
        </div>
      )}

      {sessions.length > 0 && filtered.length === 0 && (
        <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          No sessions match these filters.
        </p>
      )}

      {/* Desktop only. The desktop view is one lane per coach, so a session with
          no coach has no lane and would vanish without this bucket. The phone is
          grouped by day, where every coachless session already sits in its own
          day with a red border and "No coach yet" on the card. */}
      {lanes.unassigned.length > 0 && (
        <div className="hidden rounded-[12px] border border-err p-4 lg:block">
          <p className="label mb-3 !text-err">No coach yet — tap to fix</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lanes.unassigned.map((s) => (
              <SessionCard key={s.id} session={s} showDay onClick={() => openSession(s)} />
            ))}
          </div>
        </div>
      )}

      {/* ── Phone: day-first, every day open on arrival. ── */}
      <div className="space-y-2 lg:hidden">
        {dayGroups.map((day) => {
          // With the fold off, a cancelled session is simply a session: it takes
          // its place in the day's own order wearing its greyed, struck-through
          // card, and the count in the header counts it, because that count has
          // to describe what is on the screen underneath it.
          const dayOff = foldCancelled
            ? day.rows.filter((s) => s.status === "cancelled")
            : [];
          const dayMain = foldCancelled
            ? day.rows.filter((s) => s.status !== "cancelled")
            : day.rows;
          const open = days.map[day.key] ?? true;
          return (
            // The scroll target the week strip aims at.
            <div key={day.key} id={`day-${day.key}`} style={DAY_SCROLL_MARGIN}>
              <GroupCard
                collapsible
                open={open}
                onToggle={() => days.toggle(day.key, open)}
                title={<DayHeading label={day.label} isToday={day.isToday} />}
                meta={`${dayMain.length} class${dayMain.length === 1 ? "" : "es"}`}
              >
                <div className="grid gap-2 p-3">
                  {dayMain.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      coachName={coachNameOf(s)}
                      onClick={() => openSession(s)}
                      // No hold on a session that is already off — the menu's
                      // last row is "Cancel…", which on a called-off class
                      // offers to do the thing that has already been done.
                      // These only reach this grid when the status filter has
                      // unfolded them; behind the fold they never had a hold.
                      onLongPress={
                        s.status === "cancelled"
                          ? undefined
                          : () => {
                              setMessage(null);
                              setHeld(s);
                            }
                      }
                    />
                  ))}
                  {dayMain.length === 0 && dayOff.length > 0 && (
                    <p className="px-1 text-sm text-fg-2">
                      Nothing running — everything on this day was called off.
                    </p>
                  )}
                  {dayOff.length > 0 && (
                    <CancelledLine
                      rows={dayOff}
                      onOpen={openSession}
                      coachNameOf={coachNameOf}
                    />
                  )}
                </div>
              </GroupCard>
            </div>
          );
        })}
      </div>

      {/* ── Desktop: one lane per coach, days grouped inside. ── */}
      <div className="hidden space-y-6 lg:block">
        {lanes.byCoach
          .filter(({ rows }) => rows.length > 0)
          .map(({ coach, rows }) => (
            <div key={coach.id} className="space-y-3">
              <p className="border-b border-line pb-1.5 text-base font-semibold text-fg">
                {coach.name}
              </p>
              <div className="space-y-3">
                {groupSessionsByDay(rows, today).map((day) => (
                  <div key={day.key}>
                    <p className="mb-2">
                      <DayHeading label={day.label} isToday={day.isToday} size="sub" />
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {day.rows.map((s) => (
                        <SessionCard key={s.id} session={s} onClick={() => openSession(s)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

        {emptyCoaches.length > 0 && (
          <p className="text-sm text-fg-2">
            No sessions this week:{" "}
            <span className="text-fg">{emptyCoaches.map((c) => c.name).join(", ")}</span>.
          </p>
        )}

        {/* The lanes are per coach, and a cancellation belongs to no coach's
            working week — so on desktop they gather once here rather than being
            scattered through seven day sub-headings. That still holds with the
            fold off: they stay out of the lanes, they just stop being behind a
            tap. This is the one place the two layouts answer the status filter
            differently, and it is the lanes that force it — the phone has a day
            to put them back into and the desktop has only a coach. */}
        {cancelled.length > 0 && (
          <div className="grid">
            <CancelledLine
              rows={cancelled}
              onOpen={openSession}
              coachNameOf={coachNameOf}
              fold={foldCancelled}
            />
          </div>
        )}
      </div>

      {coaches.length === 0 && (
        <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          No coaches yet — add one from the Coaches tab first.
        </p>
      )}

      {/* Phone: the primary add action as a floating button above the tab bar. */}
      <Fab
        label="Add a class"
        onClick={() => {
          setAdding(true);
          setMessage(null);
        }}
      />

      {message && (
        <ToastSlot>
          <ActionResult>{message}</ActionResult>
        </ToastSlot>
      )}

      <CardActionMenu
        open={!!held}
        title={
          held
            ? `${held.venueName ?? "Location TBC"} · ${formatClock(held.starts_at)}`
            : ""
        }
        onClose={() => setHeld(null)}
        actions={
          held
            ? [
                {
                  label: "Open",
                  hint: "Coach, time, capacity, who's booked",
                  onSelect: () => openSession(held),
                },
                {
                  label: "Duplicate",
                  hint: "Same location, coach and length — pick a new date",
                  onSelect: () => setDuplicating(held),
                },
                {
                  label: "Cancel…",
                  // Named with the ellipsis because it opens the question, not
                  // the deed: this one date, or every week from now on.
                  hint: "Asks whether you mean this one or every week",
                  onSelect: () => openSession(held, "cancel"),
                  destructive: true,
                },
              ]
            : []
        }
      />

      {duplicating && (
        <AdminAddSheet
          defaultRepeat="once"
          seed={{
            mode: duplicating.isPrivate
              ? "private"
              : duplicating.isSchool
                ? "school"
                : "weekly",
            venueId: duplicating.classVenueId,
            coachId: duplicating.coachId,
            capacity: duplicating.capacity,
            durationMinutes: duplicating.classDuration,
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

      {selected && (
        <AdminSessionSheet
          key={selected.id}
          session={selected}
          coaches={coaches}
          venues={venues}
          clients={clients}
          openAt={openAt}
          onClose={() => {
            setSelected(null);
            setOpenAt("edit");
            onRefresh?.();
          }}
        />
      )}

      {adding && (
        <AdminAddSheet
          onClose={() => setAdding(false)}
          onDone={(m) => {
            setMessage(m);
            setAdding(false);
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
