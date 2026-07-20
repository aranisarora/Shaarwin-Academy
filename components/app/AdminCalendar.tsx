"use client";

// The admin schedule: this week's session instances, one lane per coach.
// Tap a session to change it — "just this session" or "every week", Google
// Calendar-style. The repeating classes that generate these sessions live in
// the Weekly classes tab; here you only add one-offs.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { AdminSessionSheet } from "./AdminSessionSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import {
  clockTime,
  dayLabel,
  fmtWhen,
  sessionTimeStatus,
  wallDate,
  type ClassRow,
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
      g = { key, label: dayLabel(s.starts_at), isToday: key === today, rows: [] };
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

/** "Private · Asha Rao" / "Group class" / "School class" — the card's third line. */
function classTypeLine(s: SessionRow): string {
  if (s.isPrivate) return `Private · ${s.playerName ?? "no client yet"}`;
  return s.isSchool ? "School class" : "Group class";
}

export function AdminCalendar({
  sessions,
  coaches,
  classes,
  venues,
  clients,
  invites,
  onRefresh,
}: {
  sessions: SessionRow[];
  coaches: Coach[];
  classes: ClassRow[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
  onRefresh?: () => void;
}) {
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Filters — coach, day, venue, client and class type. Options come from the
  // sessions actually on screen this week, so no filter is ever a dead end.
  const [coachFilter, setCoachFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [venueFilter, setVenueFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const dayOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sessions) {
      const key = wallDate(s.starts_at);
      if (!seen.has(key)) seen.set(key, dayLabel(s.starts_at));
    }
    return [...seen.entries()];
  }, [sessions]);
  const venueOptions = useMemo(
    () =>
      [...new Set(sessions.map((s) => s.venueName).filter((v): v is string => !!v))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [sessions]
  );
  const clientOptions = useMemo(
    () =>
      [...new Set(sessions.map((s) => s.playerName).filter((v): v is string => !!v))].sort(
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
        if (dayFilter !== "all" && wallDate(s.starts_at) !== dayFilter) return false;
        if (venueFilter !== "all" && s.venueName !== venueFilter) return false;
        if (clientFilter !== "all" && s.playerName !== clientFilter) return false;
        if (typeFilter === "group" && (s.isPrivate || s.isSchool)) return false;
        if (typeFilter === "private" && !s.isPrivate) return false;
        if (typeFilter === "school" && !s.isSchool) return false;
        return true;
      }),
    [sessions, coachFilter, dayFilter, venueFilter, clientFilter, typeFilter]
  );

  const lanes = useMemo(() => {
    const unassigned = filtered.filter((s) => !s.coachId);
    const byCoach = coaches.map((coach) => ({
      coach,
      rows: filtered.filter((s) => s.coachId === coach.id),
    }));
    return { unassigned, byCoach };
  }, [filtered, coaches]);

  const activeClasses = classes.filter((c) => c.active);
  const today = wallDate(new Date().toISOString());
  const filtersActive =
    coachFilter !== "all" ||
    dayFilter !== "all" ||
    venueFilter !== "all" ||
    clientFilter !== "all" ||
    typeFilter !== "all";
  const emptyCoaches = filtersActive
    ? []
    : lanes.byCoach.filter(({ rows }) => rows.length === 0).map(({ coach }) => coach);

  // Card anatomy, most important first: venue name, then start–end time, then
  // the class type (private cards name the client). Colour codes status: a
  // finished session is greyed out, one happening right now carries an ember
  // ring and a live badge, and a session with no coach keeps its red border.
  // Under a day header the card shows just the time; the ungrouped "no coach"
  // box carries the full weekday + date instead.
  const Block = ({ session, showDay = false }: { session: SessionRow; showDay?: boolean }) => {
    const status = sessionTimeStatus(session.starts_at, session.ends_at);
    const tone =
      status === "completed"
        ? "border-line bg-surface-2 opacity-55"
        : !session.coachId
          ? "border-err bg-surface-2"
          : status === "in_progress"
            ? "border-ember bg-surface-2 shadow-[0_0_0_1px_var(--ember)]"
            : session.isPrivate
              ? "border-line border-l-[3px] border-l-ember bg-surface-2"
              : "border-line bg-surface-2";
    return (
      <button
        onClick={() => {
          setMessage(null);
          setSelected(session);
        }}
        className={`w-full rounded-[8px] border px-3 py-2 text-left text-sm hover:border-ember ${tone}`}
      >
        <p className="font-semibold">{session.venueName ?? "Location TBC"}</p>
        <p className="tnum text-fg-2">
          {showDay ? fmtWhen(session.starts_at) : clockTime(session.starts_at)} –{" "}
          {clockTime(session.ends_at)}
        </p>
        <p className="text-xs text-fg-2">{classTypeLine(session)}</p>
        {(status !== "upcoming" || (session.coachId && session.coachArrivedAt)) && (
          <span className="mt-1.5 inline-flex flex-wrap gap-1.5">
            {status === "in_progress" && <Badge tone="ember">● In progress</Badge>}
            {status === "completed" && <Badge>✓ Completed</Badge>}
            {status !== "completed" && session.coachId && session.coachArrivedAt && (
              <Badge tone="ok">✓ Arrived {clockTime(session.coachArrivedAt)}</Badge>
            )}
          </span>
        )}
      </button>
    );
  };

  const DayGroups = ({ rows }: { rows: SessionRow[] }) => (
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
              <Block key={s.id} session={s} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        {message ? <p className="text-sm text-fg-2">{message}</p> : <span />}
        <Button
          onClick={() => {
            setAdding(true);
            setMessage(null);
          }}
        >
          Add a one-off session
        </Button>
      </div>

      <p className="text-sm text-fg-2">
        Repeating classes are created and edited in the{" "}
        <Link href="/admin/weekly" className="text-fg underline underline-offset-4">
          Weekly classes
        </Link>{" "}
        tab.
      </p>

      {sessions.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Select
            aria-label="Filter by coach"
            value={coachFilter}
            onChange={(e) => setCoachFilter(e.target.value)}
          >
            <option value="all">All coaches</option>
            <option value="none">No coach yet</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by day"
            value={dayFilter}
            onChange={(e) => setDayFilter(e.target.value)}
          >
            <option value="all">Any day</option>
            {dayOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by venue"
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
          >
            <option value="all">All venues</option>
            {venueOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by client"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
          >
            <option value="all">All clients</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by class type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All class types</option>
            <option value="group">Group</option>
            <option value="private">Private</option>
            <option value="school">School</option>
          </Select>
        </div>
      )}

      {sessions.length > 0 && filtered.length === 0 && (
        <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          No sessions match these filters.
        </p>
      )}

      {lanes.unassigned.length > 0 && (
        <div className="rounded-[12px] border border-err p-4">
          <p className="label mb-3 !text-err">No coach yet — tap to fix</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lanes.unassigned.map((s) => (
              <Block key={s.id} session={s} showDay />
            ))}
          </div>
        </div>
      )}

      {lanes.byCoach
        .filter(({ rows }) => rows.length > 0)
        .map(({ coach, rows }) => (
          <div key={coach.id} className="space-y-3">
            <p className="border-b border-line pb-1.5 text-base font-semibold text-fg">
              {coach.name}
            </p>
            <DayGroups rows={rows} />
          </div>
        ))}

      {emptyCoaches.length > 0 && (
        <p className="text-sm text-fg-2">
          No sessions this week:{" "}
          <span className="text-fg">{emptyCoaches.map((c) => c.name).join(", ")}</span>.
        </p>
      )}

      {coaches.length === 0 && (
        <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          No coaches yet — add one from the Coaches tab first.
        </p>
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
          classes={activeClasses}
          coaches={coaches}
          venues={venues}
          clients={clients}
          invites={invites}
        />
      )}
    </div>
  );
}
