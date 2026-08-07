"use client";

// The admin schedule: this week's session instances, one lane per coach.
// Tap a session to change it — "just this session" or "every week", Google
// Calendar-style. The repeating classes that generate these sessions live in
// the Weekly classes tab; here you only add one-offs.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FilterBar, type FilterDef } from "@/components/ui/FilterBar";
import { Fab } from "@/components/ui/Fab";
import { ActionResult } from "./ActionResult";
import { AdminSessionSheet } from "./AdminSessionSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import { SessionCard } from "./ClassCard";
import { KIND_WORD } from "./class-type";
import { formatDay, sessionTimeStatus, wallDate } from "@/lib/academy-time";
import {
  type ClientOption,
  type Coach,
  type InviteOption,
  type SessionRow,
  type Venue,
} from "./admin-calendar-types";

// Sessions arrive already sorted by start time, so grouping them by academy
// wall-date yields days in chronological order with each day's sessions in
// order. Within a day, finished sessions sink to the bottom so what's next
// reads first. `today` (an academy YYYY-MM-DD) flags the current day.
type DayGroup = { key: string; label: string; isToday: boolean; rows: SessionRow[] };
function groupByDay(rows: SessionRow[], today: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const s of rows) {
    const key = wallDate(s.starts_at);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: formatDay(s.starts_at), isToday: key === today, rows: [] };
      groups.push(g);
    }
    g.rows.push(s);
  }
  for (const g of groups) {
    g.rows = [
      ...g.rows.filter((s) => sessionTimeStatus(s.starts_at, s.ends_at) !== "completed"),
      ...g.rows.filter((s) => sessionTimeStatus(s.starts_at, s.ends_at) === "completed"),
    ];
  }
  return groups;
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
  // Deep-link from the Weekly classes tab — open this session on first render.
  openSessionId?: string | null;
}) {
  const [selected, setSelected] = useState<SessionRow | null>(
    () => sessions.find((s) => s.id === openSessionId) ?? null
  );
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Filters — coach, venue, class type. Three is what fits on a 390px phone:
  // the row held five, of which only 3.3 were ever painted, the scrollbar is
  // hidden and there was no fade, so the founder never discovered "All types" —
  // the one chip that answers his "I can't tell a private from a school class".
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

  const lanes = useMemo(() => {
    const unassigned = filtered.filter((s) => !s.coachId);
    const byCoach = coaches.map((coach) => ({
      coach,
      rows: filtered.filter((s) => s.coachId === coach.id),
    }));
    return { unassigned, byCoach };
  }, [filtered, coaches]);

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
  const coachNameOf = (s: SessionRow) => (s.coachId ? coachNameById.get(s.coachId) ?? null : null);

  // Success toasts from Add auto-clear so they never reserve layout space.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  const openSession = (session: SessionRow) => {
    setMessage(null);
    setSelected(session);
  };

  // Card look + border language live in the shared ClassCard; here we only wire
  // the tap. Under a day header the card shows just the time; the ungrouped
  // "no coach" box carries the full weekday + date via showDay.
  //
  // This used to be a `Block` wrapper declared here in the render body, which
  // gave it a new component type on every render — so every card in the
  // unassigned box and every card in the desktop lanes unmounted and remounted
  // each time a filter moved. The phone list never went through it, so the two
  // halves of this screen behaved differently for no reason anyone chose.

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

  // Day-first grouping for the phone: chronological days, all of them open.
  // Coach moves onto each card (line 3).
  const dayGroups = useMemo(() => groupByDay(filtered, today), [filtered, today]);

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
          Add a one-time class
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
          grouped by day, where every coachless session is already sitting in its
          own day with a red border and "No coach yet" on the card — so on the
          phone this box listed all of them a second time. */}
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

      {/* ── Phone: day-first, every day open. ──
          These were <details> with only today expanded, so the tab whose job is
          "show me my week" opened on one class and six grey bars, and answering
          "what's on tomorrow?" cost a tap. Today is also the one day the Today
          tab already covers. They are plain headings now: no toggle to catch a
          stray thumb, and no collapse state to lose on every week change. */}
      <div className="space-y-2 lg:hidden">
        {dayGroups.map((day) => (
          <div
            key={day.key}
            className="overflow-hidden rounded-[12px] border border-line bg-surface-2"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className={`font-semibold ${day.isToday ? "text-ember" : "text-fg"}`}>
                {day.label}
                {day.isToday ? " · Today" : ""}
              </span>
              <span className="tnum shrink-0 text-sm text-fg-2">
                {day.rows.length} class{day.rows.length === 1 ? "" : "es"}
              </span>
            </div>
            <div className="grid gap-2 border-t border-line p-3">
              {day.rows.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  coachName={coachNameOf(s)}
                  onClick={() => openSession(s)}
                />
              ))}
            </div>
          </div>
        ))}
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
                {groupByDay(rows, today).map((day) => (
                  <div key={day.key}>
                    <p
                      className={`mb-2 text-xs font-medium ${day.isToday ? "text-ember" : "text-fg-2"}`}
                    >
                      {day.label}
                      {day.isToday ? " · Today" : ""}
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
      </div>

      {coaches.length === 0 && (
        <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          No coaches yet — add one from the Coaches tab first.
        </p>
      )}

      {/* Phone: the primary add action as a floating button above the tab bar. */}
      <Fab
        label="Add a one-time class"
        onClick={() => {
          setAdding(true);
          setMessage(null);
        }}
      />

      {/* Transient success line as a bottom toast — no reserved layout space. */}
      {message && (
        <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 mx-auto max-w-md lg:bottom-6">
          <ActionResult>{message}</ActionResult>
        </div>
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
          variant="oneoff"
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
