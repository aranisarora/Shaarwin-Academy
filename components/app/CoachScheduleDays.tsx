"use client";

// The coach's 4-week schedule, day by day. Today (and any day holding the
// featured live/next session) stays fully expanded; every other day collapses
// to a tappable header row on the phone so "what's on today" is one screen, not
// a long scroll. On ≥1024px every day stays expanded — desktop has the room.
// All per-session computation happens in the server component (app/coach/page.tsx);
// this component only owns the collapse state.

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { NavigateButton } from "@/components/app/NavigateButton";

type ScheduleSession = {
  id: string;
  locationName: string;
  timeLabel: string;
  typeLine: string;
  status: "in_progress" | "upcoming" | "completed";
  featured: boolean;
  travelGap: boolean;
  isPrivate: boolean;
  confirmed: number;
  capacity: number;
  lat: number | null;
  lng: number | null;
};

export type ScheduleDay = {
  key: string;
  label: string;
  isToday: boolean;
  firstTime: string;
  sessions: ScheduleSession[];
};

export function CoachScheduleDays({ days }: { days: ScheduleDay[] }) {
  // A day is open when the coach expands it — plus any non-today day that holds
  // the featured session, so the next session up is never hidden behind a tap.
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        days
          .filter((d) => !d.isToday && d.sessions.some((s) => s.featured))
          .map((d) => d.key)
      )
  );

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {days.map((day) => {
        const open = day.isToday || expanded.has(day.key);
        return (
          <section key={day.key}>
            {day.isToday ? (
              <div className="mb-3 border-b border-line pb-2">
                <p className="font-display text-2xl">Today</p>
                <p className="text-sm text-fg-2">{day.key}</p>
              </div>
            ) : (
              <>
                {/* Phone: the whole header is a tap target that expands the day. */}
                <button
                  type="button"
                  onClick={() => toggle(day.key)}
                  aria-expanded={open}
                  className="mb-3 flex w-full items-center justify-between gap-3 border-b border-line pb-2 text-left lg:hidden"
                >
                  <span className="min-w-0">
                    <span className="font-display text-2xl">{day.label}</span>
                    <span className="mt-0.5 block text-sm text-fg-2">
                      {day.sessions.length} session
                      {day.sessions.length === 1 ? "" : "s"} · from {day.firstTime}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={`shrink-0 text-fg-2 transition-transform ${open ? "rotate-90" : ""}`}
                  >
                    ›
                  </span>
                </button>
                {/* Desktop: the plain day heading, always followed by its list. */}
                <div className="mb-3 hidden border-b border-line pb-2 lg:block">
                  <p className="font-display text-2xl">{day.label}</p>
                </div>
              </>
            )}

            <ol className={`space-y-0 lg:block ${open ? "" : "hidden"}`}>
              {day.sessions.map((s) => {
                const tone =
                  s.status === "completed"
                    ? "border-line bg-surface-2 opacity-55"
                    : s.featured
                      ? "border-ember bg-surface-2 shadow-[0_0_0_1px_var(--ember)]"
                      : "border-line bg-surface-2 hover:border-ember";
                const timeClass = s.featured ? "text-3xl" : "text-2xl";
                return (
                  <li key={s.id}>
                    {s.travelGap && (
                      <p className="tnum py-2 text-center text-xs text-fg-2">
                        ── travel ──
                      </p>
                    )}
                    <div
                      className={`relative mb-3 rounded-[12px] border px-4 ${s.featured ? "py-4" : "py-3.5"} ${tone}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={`/coach/session/${s.id}`}
                          aria-label={`${s.locationName} at ${s.timeLabel}`}
                          className="min-w-0 after:absolute after:inset-0 after:content-['']"
                        >
                          <p className="font-semibold">{s.locationName}</p>
                          <p className={`tnum font-display ${timeClass}`}>{s.timeLabel}</p>
                          <p className="mt-0.5 text-sm text-fg-2">{s.typeLine}</p>
                        </Link>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {s.status === "in_progress" ? (
                            <Badge tone="ember">● Live</Badge>
                          ) : s.status === "completed" ? (
                            <Badge>✓ Done</Badge>
                          ) : (
                            <Badge tone={s.isPrivate ? "ember" : "neutral"}>
                              {s.isPrivate ? "Private" : "Group"}
                            </Badge>
                          )}
                          <span className="tnum text-xs text-fg-2">
                            {s.confirmed}/{s.capacity}
                          </span>
                        </div>
                      </div>
                      <NavigateButton lat={s.lat} lng={s.lng} className="mt-2.5" />
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
