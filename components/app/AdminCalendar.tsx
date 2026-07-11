"use client";

// The merged admin calendar: week view (one lane per coach), the weekly
// classes that generate it, and everything you can add to it. Tap a session
// to change it — "just this session" or "every week", Google Calendar-style.

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { topUpSessions } from "@/app/admin/calendar/actions";
import { AdminSessionSheet } from "./AdminSessionSheet";
import { AdminClassSheet } from "./AdminClassSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import {
  WEEKDAY_NAME,
  clockTime,
  fmtWhen,
  type ClassRow,
  type ClientOption,
  type Coach,
  type SessionRow,
  type Venue,
} from "./admin-calendar-types";

export function AdminCalendar({
  sessions,
  coaches,
  classes,
  venues,
  clients,
}: {
  sessions: SessionRow[];
  coaches: Coach[];
  classes: ClassRow[];
  venues: Venue[];
  clients: ClientOption[];
}) {
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lanes = useMemo(() => {
    const unassigned = sessions.filter((s) => !s.coachId);
    const byCoach = coaches.map((coach) => ({
      coach,
      rows: sessions.filter((s) => s.coachId === coach.id),
    }));
    return { unassigned, byCoach };
  }, [sessions, coaches]);

  const activeClasses = classes.filter((c) => c.active);

  const Block = ({ session }: { session: SessionRow }) => (
    <button
      onClick={() => {
        setMessage(null);
        setSelected(session);
      }}
      className={`w-full rounded-[8px] border px-3 py-2 text-left text-sm hover:border-ember ${
        session.coachId ? "border-line bg-surface-2" : "border-err bg-surface-2"
      }`}
    >
      <p className="tnum font-medium">{fmtWhen(session.starts_at)}</p>
      <p className="text-xs text-fg-2">
        {session.title}
        {session.venueName ? ` — ${session.venueName}` : ""}
      </p>
      {session.coachId && session.coachArrivedAt && (
        <span className="mt-1.5 inline-flex">
          <Badge tone="ok">✓ Arrived {clockTime(session.coachArrivedAt)}</Badge>
        </span>
      )}
    </button>
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
              <Block key={s.id} session={s} />
            ))}
          </div>
        </div>
      )}

      {lanes.byCoach.map(({ coach, rows }) => (
        <div key={coach.id}>
          <p className="label mb-2">{coach.name}</p>
          {rows.length === 0 ? (
            <p className="rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
              Nothing this week.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((s) => (
                <Block key={s.id} session={s} />
              ))}
            </div>
          )}
        </div>
      ))}

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
        {classes.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setMessage(null);
              setEditingClass(c);
            }}
            className="flex w-full items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-left hover:border-ember"
          >
            <span>
              <span className="block font-medium">{c.title}</span>
              <span className="block text-sm text-fg-2">
                {WEEKDAY_NAME[c.weekday] ?? "One-off"}s {c.time} · {c.venueName ?? "No venue"} ·{" "}
                {c.duration} min · up to {c.capacity} players
              </span>
            </span>
            <span className="flex flex-col items-end gap-1.5">
              <Badge>{c.level}</Badge>
              {!c.active && <Badge tone="err">paused</Badge>}
            </span>
          </button>
        ))}
        {classes.length === 0 && (
          <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
            No weekly classes yet — tap “Add to schedule”.
          </p>
        )}
      </div>

      {selected && (
        <AdminSessionSheet
          key={selected.id}
          session={selected}
          coaches={coaches}
          venues={venues}
          onClose={() => setSelected(null)}
        />
      )}

      {editingClass && (
        <AdminClassSheet
          key={editingClass.id}
          cls={editingClass}
          venues={venues}
          onClose={() => setEditingClass(null)}
          onDone={(m) => {
            setMessage(m);
            setEditingClass(null);
          }}
        />
      )}

      {adding && (
        <AdminAddSheet
          onClose={() => setAdding(false)}
          onDone={(m) => {
            setMessage(m);
            setAdding(false);
          }}
          classes={activeClasses.map((c) => ({ id: c.id, title: c.title }))}
          coaches={coaches}
          venues={venues}
          clients={clients}
        />
      )}
    </div>
  );
}
