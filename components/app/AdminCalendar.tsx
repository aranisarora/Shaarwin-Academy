"use client";

// The merged admin calendar: week view (one lane per coach), the weekly
// classes that generate it, and everything you can add to it. Tap a session
// to change it — "just this session" or "every week", Google Calendar-style.

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { topUpSessions } from "@/app/admin/calendar/actions";
import { AdminSessionSheet } from "./AdminSessionSheet";
import { AdminClassSheet } from "./AdminClassSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import { time12h } from "./ClassFields";
import {
  WEEKDAY_NAME,
  WEEKDAYS,
  clockTime,
  dayLabel,
  fmtWhen,
  wallDate,
  type ClassRow,
  type ClientOption,
  type Coach,
  type InviteOption,
  type SessionRow,
  type Venue,
} from "./admin-calendar-types";

const WEEKDAY_ORDER = WEEKDAYS.map(([code]) => code) as string[];

// Sessions arrive already sorted by start time, so grouping them by academy
// wall-date yields days in chronological order with each day's sessions in
// order. `today` (an academy YYYY-MM-DD) flags the current day in this week.
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
  return groups;
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
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Filters for the weekly-classes list — location (venue), day, level and
  // status. Options are drawn from the classes that actually exist so we never
  // show an empty bucket.
  const [venueFilter, setVenueFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");

  const venueOptions = useMemo(
    () =>
      [...new Set(classes.map((c) => c.venueName ?? ""))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [classes]
  );
  const dayOptions = useMemo(
    () =>
      [...new Set(classes.map((c) => c.weekday))].sort(
        (a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b)
      ),
    [classes]
  );
  const levelOptions = useMemo(
    () => [...new Set(classes.map((c) => c.level))].sort((a, b) => a.localeCompare(b)),
    [classes]
  );

  const filteredClasses = useMemo(
    () =>
      classes.filter((c) => {
        if (venueFilter !== "all" && (c.venueName ?? "") !== venueFilter) return false;
        if (dayFilter !== "all" && c.weekday !== dayFilter) return false;
        if (levelFilter !== "all" && c.level !== levelFilter) return false;
        if (statusFilter === "active" && !c.active) return false;
        if (statusFilter === "paused" && (c.active || c.endsOn)) return false;
        if (statusFilter === "ended" && (c.active || !c.endsOn)) return false;
        return true;
      }),
    [classes, venueFilter, dayFilter, levelFilter, statusFilter]
  );

  const lanes = useMemo(() => {
    const unassigned = sessions.filter((s) => !s.coachId);
    const byCoach = coaches.map((coach) => ({
      coach,
      rows: sessions.filter((s) => s.coachId === coach.id),
    }));
    return { unassigned, byCoach };
  }, [sessions, coaches]);

  const activeClasses = classes.filter((c) => c.active);
  const today = wallDate(new Date().toISOString());
  const emptyCoaches = lanes.byCoach.filter(({ rows }) => rows.length === 0).map(({ coach }) => coach);

  // Under a day header the card only needs the time; in the ungrouped
  // "no coach" box it carries the full weekday + date instead.
  const Block = ({ session, showDay = false }: { session: SessionRow; showDay?: boolean }) => (
    <button
      onClick={() => {
        setMessage(null);
        setSelected(session);
      }}
      className={`w-full rounded-[8px] border px-3 py-2 text-left text-sm hover:border-ember ${
        session.coachId ? "border-line bg-surface-2" : "border-err bg-surface-2"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="tnum font-medium">
          {showDay ? fmtWhen(session.starts_at) : clockTime(session.starts_at)}
        </p>
        {session.isPrivate && <Badge tone="ember">Private</Badge>}
      </div>
      <p className="text-xs text-fg-2">
        {session.title}
        {(session.playerName || session.venueName)
          ? ` — ${[session.playerName, session.venueName].filter(Boolean).join(" @ ")}`
          : ""}
      </p>
      {session.coachId && session.coachArrivedAt && (
        <span className="mt-1.5 inline-flex">
          <Badge tone="ok">✓ Arrived {clockTime(session.coachArrivedAt)}</Badge>
        </span>
      )}
    </button>
  );

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
          Add to schedule
        </Button>
      </div>

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
            <p className="label">{coach.name}</p>
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

      {/* ── The weekly classes behind the calendar ── */}
      <div className="space-y-2 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="label">Weekly classes</p>
          <button
            disabled={pending}
            className="text-sm text-fg-2 underline-offset-4 hover:underline"
            onClick={() =>
              startTransition(async () => {
                const r = await topUpSessions();
                setMessage(
                  r.ok
                    ? r.created
                      ? `Added ${r.created} upcoming sessions.`
                      : "The calendar is already fully topped up."
                    : (r.error ?? "Failed.")
                );
              })
            }
          >
            {pending ? "Topping up…" : "Top up the next 8 weeks"}
          </button>
        </div>
        <p className="text-sm text-fg-2">
          Each one repeats every week and fills the calendar above. Tap to change a class —
          for a one-week-only change, tap that session in the calendar instead.
        </p>

        {classes.length > 0 && (
          <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
            <Select
              aria-label="Filter by location"
              value={venueFilter}
              onChange={(e) => setVenueFilter(e.target.value)}
            >
              <option value="all">All locations</option>
              {venueOptions.map((v) => (
                <option key={v} value={v}>
                  {v || "No venue"}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by day"
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
            >
              <option value="all">Any day</option>
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_NAME[d] ?? d}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by level"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
            >
              <option value="all">Any level</option>
              {levelOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="ended">Ended</option>
            </Select>
          </div>
        )}

        {filteredClasses.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setMessage(null);
              setEditingClass(c);
            }}
            className="flex w-full items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-left hover:border-ember"
          >
            <span>
              <span className="block font-medium">
                {c.title} · {c.venueName ?? "No venue"}
              </span>
              <span className="block text-sm text-fg-2">
                {WEEKDAY_NAME[c.weekday] ?? "One-off"}s {time12h(c.time)} ·{" "}
                {c.duration} min · up to {c.capacity} players
              </span>
            </span>
            <span className="flex flex-col items-end gap-1.5">
              <Badge>{c.level}</Badge>
              {!c.active && <Badge tone="err">{c.endsOn ? "ended — tap to restore" : "paused"}</Badge>}
            </span>
          </button>
        ))}
        {classes.length === 0 && (
          <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
            No weekly classes yet — tap “Add to schedule”.
          </p>
        )}
        {classes.length > 0 && filteredClasses.length === 0 && (
          <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
            No classes match these filters.
          </p>
        )}
      </div>

      {selected && (
        <AdminSessionSheet
          key={selected.id}
          session={selected}
          coaches={coaches}
          venues={venues}
          onClose={() => {
            setSelected(null);
            onRefresh?.();
          }}
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

      {adding && (
        <AdminAddSheet
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
