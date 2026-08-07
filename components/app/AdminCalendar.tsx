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
// bought to gain clarity on the rare bad one.
//
// The filters and the day-open state are NOT held here any more. They are the
// same three questions the Timetable asks, and a founder who narrows to one
// coach and flips the switch should still be looking at that coach. See
// AdminScheduleTabs.

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
import { formatClock, wallDate } from "@/lib/academy-time";
import { venueKeyOf } from "@/lib/venue-display";
import type { OpenMap, ScheduleFilters } from "./AdminScheduleTabs";
import { KIND_WORD } from "./class-type";
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

/** The cancellations for one day, folded into a line. Collapsed by default:
 *  the count is the fact he needs while scanning, the reason the fact he needs
 *  only once he has stopped. */
function CancelledLine({
  rows,
  onOpen,
  coachNameOf,
}: {
  rows: SessionRow[];
  onOpen: (s: SessionRow) => void;
  coachNameOf: (s: SessionRow) => string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="col-span-full">
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
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
  /** Coach / location / type, shared with the Timetable view. */
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

  const { coach: coachFilter, venue: venueFilter, type: typeFilter } = filters;

  // Drawn from this week's sessions, PLUS whatever is currently filtered on.
  // Without that last part, paging to a week where the chosen hall has nothing
  // dropped its option — so the chip fell back to reading "All locations"
  // while still filtering, in ember, with an ✕. It looked cleared and wasn't.
  //
  // Keyed on the venue rather than the full label, so this list and the
  // Timetable's are the same list and one chip can drive both. See venueKeyOf.
  const venueOptions = useMemo(
    () =>
      [
        ...new Set([
          ...sessions.map((s) => venueKeyOf(s.venueName)).filter(Boolean),
          ...(venueFilter !== "all" ? [venueFilter] : []),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [sessions, venueFilter]
  );

  const filtered = useMemo(
    () =>
      sessions.filter((s) => {
        if (coachFilter === "none" && s.coachId) return false;
        if (coachFilter !== "all" && coachFilter !== "none" && s.coachId !== coachFilter)
          return false;
        if (venueFilter !== "all" && venueKeyOf(s.venueName) !== venueFilter) return false;
        if (typeFilter === "group" && (s.isPrivate || s.isSchool)) return false;
        if (typeFilter === "private" && !s.isPrivate) return false;
        if (typeFilter === "school" && !s.isSchool) return false;
        return true;
      }),
    [sessions, coachFilter, venueFilter, typeFilter]
  );

  // Everything below reads `live`. A cancelled session needs no coach, so it
  // raises no alarm, fills no lane, and counts towards nothing that is "on" —
  // it exists only on its own day's cancelled line.
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
  const filtersActive =
    coachFilter !== "all" || venueFilter !== "all" || typeFilter !== "all";
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

  const filterDefs: FilterDef[] = [
    {
      key: "coach",
      aria: "Filter by coach",
      label: "All coaches",
      value: coachFilter,
      defaultValue: "all",
      onChange: filters.setCoach,
      options: [
        { value: "all", label: "All coaches" },
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
      value: venueFilter,
      defaultValue: "all",
      onChange: filters.setVenue,
      options: [
        { value: "all", label: "All locations" },
        ...venueOptions.map((v) => ({ value: v, label: v })),
      ],
    },
    {
      key: "type",
      aria: "Filter by class type",
      label: "All types",
      value: typeFilter,
      defaultValue: "all",
      onChange: filters.setType,
      // The app's one set of names for the three kinds — the chips used to say
      // "Group / Private / School" while the cards below them said "Group class
      // / Private / School class" and the Add sheet said a third thing again.
      // Filtering to a word you cannot then find on a card is a small betrayal
      // that costs a scroll every time.
      options: [
        { value: "all", label: "All class types" },
        { value: "group", label: KIND_WORD.group },
        { value: "private", label: KIND_WORD.private },
        { value: "school", label: KIND_WORD.school },
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
          const dayLive = day.rows.filter((s) => s.status !== "cancelled");
          const dayOff = day.rows.filter((s) => s.status === "cancelled");
          const open = days.map[day.key] ?? true;
          return (
            // The scroll target the week strip aims at.
            <div key={day.key} id={`day-${day.key}`} style={DAY_SCROLL_MARGIN}>
              <GroupCard
                collapsible
                open={open}
                onToggle={() => days.toggle(day.key, open)}
                title={<DayHeading label={day.label} isToday={day.isToday} />}
                meta={`${dayLive.length} class${dayLive.length === 1 ? "" : "es"}`}
              >
                <div className="grid gap-2 p-3">
                  {dayLive.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      coachName={coachNameOf(s)}
                      onClick={() => openSession(s)}
                      onLongPress={() => {
                        setMessage(null);
                        setHeld(s);
                      }}
                    />
                  ))}
                  {dayLive.length === 0 && dayOff.length > 0 && (
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
            scattered through seven day sub-headings. */}
        {cancelled.length > 0 && (
          <div className="grid">
            <CancelledLine rows={cancelled} onOpen={openSession} coachNameOf={coachNameOf} />
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
