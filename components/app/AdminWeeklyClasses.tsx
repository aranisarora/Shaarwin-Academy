"use client";

// The Weekly classes tab: every repeating class, grouped under the venue it
// runs at. Each venue is a card; the classes beneath it read coach · day ·
// time. Tap a class to change it for every week; one-week-only changes happen
// on that session in the Schedule tab.

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { topUpSessions } from "@/app/admin/schedule/actions";
import { AdminClassSheet } from "./AdminClassSheet";
import { AdminAddSheet } from "./AdminAddSheet";
import { time12h } from "./ClassFields";
import {
  WEEKDAY_NAME,
  WEEKDAYS,
  type ClassRow,
  type ClientOption,
  type Coach,
  type InviteOption,
  type Venue,
} from "./admin-calendar-types";

const WEEKDAY_ORDER = WEEKDAYS.map(([code]) => code) as string[];

/** "18:30" + 60 → "7:30 pm" — the class's finish time for the day/time line. */
function endTime12h(time: string, durationMinutes: number): string {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h)) return time;
  const total = h * 60 + (m || 0) + durationMinutes;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return time12h(`${eh}:${String(em).padStart(2, "0")}`);
}

export function AdminWeeklyClasses({
  classes,
  coaches,
  venues,
  clients,
  invites,
}: {
  classes: ClassRow[];
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
}) {
  const router = useRouter();
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Filters — location (venue), day and status. Options are drawn from the
  // classes that actually exist so we never show an empty bucket.
  const [venueFilter, setVenueFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
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

  // Group the filtered classes under their venue. Within each venue the
  // classes are sorted by time (then day) so the card reads top-to-bottom in
  // slot order; venues themselves are listed alphabetically, "No venue" last.
  const venueGroups = useMemo(() => {
    const byVenue = new Map<string, ClassRow[]>();
    for (const c of filteredClasses) {
      const key = c.venueName ?? "";
      (byVenue.get(key) ?? byVenue.set(key, []).get(key)!).push(c);
    }
    return [...byVenue.entries()]
      .map(([venue, rows]) => ({
        venue,
        rows: rows.sort((a, b) =>
          a.time.localeCompare(b.time) ||
          WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday)
        ),
      }))
      .sort((a, b) => {
        if (!a.venue) return 1;
        if (!b.venue) return -1;
        return a.venue.localeCompare(b.venue);
      });
  }, [filteredClasses]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {message ? <p className="text-sm text-fg-2">{message}</p> : <span />}
        <Button
          onClick={() => {
            setCreating(true);
            setMessage(null);
          }}
        >
          Create a class
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-fg-2">
          Each class repeats every week and fills the Schedule tab. Tap one to change it —
          for a one-week-only change, tap that session in the Schedule tab instead.
        </p>
        <button
          disabled={pending}
          className="shrink-0 text-sm text-fg-2 underline-offset-4 hover:underline"
          onClick={() =>
            startTransition(async () => {
              const r = await topUpSessions();
              setMessage(
                r.ok
                  ? r.created
                    ? `Added ${r.created} upcoming sessions.`
                    : "The schedule is already fully topped up."
                  : (r.error ?? "Failed.")
              );
              if (r.ok) router.refresh();
            })
          }
        >
          {pending ? "Topping up…" : "Top up the next 8 weeks"}
        </button>
      </div>

      {classes.length > 0 && (
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-3">
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

      {venueGroups.map((group) => (
        <div
          key={group.venue || "no-venue"}
          className="overflow-hidden rounded-[14px] border border-line bg-surface-2"
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
            <span className="font-semibold">{group.venue || "No venue"}</span>
            <span className="shrink-0 text-sm text-fg-2">
              {group.rows.length} class{group.rows.length === 1 ? "" : "es"}
            </span>
          </div>
          <div className="divide-y divide-line">
            {group.rows.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setMessage(null);
                  setEditingClass(c);
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
              >
                <span>
                  <span className="block font-medium">{c.coachName ?? "No coach yet"}</span>
                  <span className="block text-sm text-fg-2">
                    {WEEKDAY_NAME[c.weekday] ?? "One-off"}s · {time12h(c.time)} –{" "}
                    {endTime12h(c.time, c.duration)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  {c.isSchool && <Badge>School</Badge>}
                  {!c.active && (
                    <Badge tone="err">{c.endsOn ? "ended — tap to restore" : "paused"}</Badge>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {classes.length === 0 && (
        <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          No weekly classes yet — tap “Create a class”.
        </p>
      )}
      {classes.length > 0 && filteredClasses.length === 0 && (
        <p className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
          No classes match these filters.
        </p>
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

      {creating && (
        <AdminAddSheet
          variant="create"
          onClose={() => setCreating(false)}
          onDone={(m) => {
            setMessage(m);
            setCreating(false);
            router.refresh();
          }}
          classes={classes.filter((c) => c.active)}
          coaches={coaches}
          venues={venues}
          clients={clients}
          invites={invites}
        />
      )}
    </div>
  );
}
