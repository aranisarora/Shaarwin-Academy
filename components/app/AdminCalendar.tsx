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

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FilterBar, type FilterDef } from "@/components/ui/FilterBar";
import { Fab } from "@/components/ui/Fab";
import { GroupCard } from "@/components/ui/GroupCard";
import { ToastSlot, useAutoClearMessage } from "@/components/ui/Toast";
import { ActionResult } from "./ActionResult";
import { AdminSessionSheet } from "./AdminSessionSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import { DayHeading } from "./DayHeading";
import { SessionCard } from "./ClassCard";
import { groupSessionsByDay } from "@/lib/group-by-day";
import { wallDate } from "@/lib/academy-time";
import {
  type ClientOption,
  type Coach,
  type InviteOption,
  type SessionRow,
  type Venue,
} from "./admin-calendar-types";

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
        className="pressable flex min-h-9 w-full items-center gap-1.5 rounded-[8px] px-1 text-left text-sm text-fg-2 hover:text-ember"
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
  onRefresh,
  openSessionId = null,
}: {
  sessions: SessionRow[];
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
  onRefresh?: () => void;
  /** Deep-link from a notification or the Timetable — open this session. */
  openSessionId?: string | null;
}) {
  const [selected, setSelected] = useState<SessionRow | null>(
    () => sessions.find((s) => s.id === openSessionId) ?? null
  );
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useAutoClearMessage();

  // Filters — coach, venue, class type. Three is what fits on a 390px phone.
  // Day went because the list is already grouped by day and every day is on
  // screen; client went because that question belongs on the Players tab.
  const [coachFilter, setCoachFilter] = useState("all");
  const [venueFilter, setVenueFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const venueOptions = useMemo(
    () =>
      [...new Set(sessions.map((s) => s.venueName).filter((v): v is string => !!v))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [sessions]
  );

  const filtered = useMemo(
    () =>
      sessions.filter((s) => {
        if (coachFilter === "none" && s.coachId) return false;
        if (coachFilter !== "all" && coachFilter !== "none" && s.coachId !== coachFilter)
          return false;
        if (venueFilter !== "all" && s.venueName !== venueFilter) return false;
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

  const openSession = (session: SessionRow) => {
    setMessage(null);
    setSelected(session);
  };

  const filterDefs: FilterDef[] = [
    {
      key: "coach",
      aria: "Filter by coach",
      label: "All coaches",
      value: coachFilter,
      defaultValue: "all",
      onChange: setCoachFilter,
      options: [
        { value: "all", label: "All coaches" },
        { value: "none", label: "No coach yet" },
        ...coaches.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      key: "venue",
      aria: "Filter by venue",
      label: "All venues",
      value: venueFilter,
      defaultValue: "all",
      onChange: setVenueFilter,
      options: [
        { value: "all", label: "All venues" },
        ...venueOptions.map((v) => ({ value: v, label: v })),
      ],
    },
    {
      key: "type",
      aria: "Filter by class type",
      label: "All types",
      value: typeFilter,
      defaultValue: "all",
      onChange: setTypeFilter,
      options: [
        { value: "all", label: "All class types" },
        { value: "group", label: "Group" },
        { value: "private", label: "Private" },
        { value: "school", label: "School" },
      ],
    },
  ];

  // Day-first for the phone. Days come from every session including the
  // cancelled ones, so a day whose only class was called off still appears —
  // saying so is the entire point.
  const dayGroups = useMemo(() => groupSessionsByDay(filtered, today), [filtered, today]);

  return (
    <div className="space-y-5">
      {/* Desktop keeps the inline "Add" button; the phone gets a FAB (below). */}
      <div className="hidden justify-end lg:flex">
        <Button
          onClick={() => {
            setAdding(true);
            setMessage(null);
          }}
        >
          Add a class
        </Button>
      </div>

      {sessions.length > 0 && <FilterBar filters={filterDefs} />}

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

      {/* ── Phone: day-first, every day open. ── */}
      <div className="space-y-2 lg:hidden">
        {dayGroups.map((day) => {
          const dayLive = day.rows.filter((s) => s.status !== "cancelled");
          const dayOff = day.rows.filter((s) => s.status === "cancelled");
          return (
            // The scroll target the week strip aims at. scroll-mt clears the
            // sticky toggle + strip, which would otherwise sit on the heading.
            <div key={day.key} id={`day-${day.key}`} className="scroll-mt-40">
              <GroupCard
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

      {selected && (
        <AdminSessionSheet
          key={selected.id}
          session={selected}
          coaches={coaches}
          venues={venues}
          clients={clients}
          onClose={() => {
            setSelected(null);
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
