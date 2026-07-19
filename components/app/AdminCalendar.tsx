"use client";

// The admin schedule: this week's session instances, one lane per coach.
// Tap a session to change it — "just this session" or "every week", Google
// Calendar-style. The repeating classes that generate these sessions live in
// the Weekly classes tab; here you only add one-offs.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AdminSessionSheet } from "./AdminSessionSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import {
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
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  // Card colour codes the session: red border = no coach yet (fix me);
  // ember left-accent = private 1:1; plain = a group class. Under a day
  // header the card shows just the time; the ungrouped "no coach" box
  // carries the full weekday + date instead.
  const Block = ({ session, showDay = false }: { session: SessionRow; showDay?: boolean }) => {
    const tone = !session.coachId
      ? "border-err bg-surface-2"
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
        <p className="tnum font-medium">
          {showDay ? fmtWhen(session.starts_at) : clockTime(session.starts_at)} –{" "}
          {clockTime(session.ends_at)}
        </p>
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
