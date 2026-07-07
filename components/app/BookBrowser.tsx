"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { VenueMap } from "@/components/marketing/VenueMap";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { bookSession, type BookResult } from "@/app/app/book/actions";
import { enablePush, type PushState } from "@/lib/push";
import type { BrowseSession } from "@/lib/booking";
import type { Venue } from "@/lib/data";

const LEVELS = ["all", "beginner", "intermediate", "advanced", "elite"] as const;
const WEEKDAYS = ["all", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function weekdayOf(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function BookBrowser({
  sessions,
  venues,
  players,
  hasSubscription,
}: {
  sessions: BrowseSession[];
  venues: Venue[];
  players: { id: string; full_name: string }[];
  hasSubscription: boolean;
}) {
  const [level, setLevel] = useState<string>("all");
  const [weekday, setWeekday] = useState<string>("all");
  const [selected, setSelected] = useState<BrowseSession | null>(null);
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [result, setResult] = useState<BookResult | null>(null);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      sessions.filter(
        (s) =>
          (level === "all" || s.level === level) &&
          (weekday === "all" || weekdayOf(s.starts_at) === weekday)
      ),
    [sessions, level, weekday]
  );

  const byVenue = useMemo(() => {
    const map = new Map<string, { venue: BrowseSession["venue"]; rows: BrowseSession[] }>();
    for (const s of filtered) {
      const key = s.venue?.id ?? "unknown";
      const entry = map.get(key) ?? { venue: s.venue, rows: [] };
      entry.rows.push(s);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [filtered]);

  function openSheet(session: BrowseSession) {
    setResult(null);
    setSelected(session);
  }

  function book() {
    if (!selected || !playerId) return;
    startTransition(async () => {
      const r = await bookSession(selected.id, playerId);
      setResult(r);
      if (r.ok) {
        localStorage.setItem("sharwin_has_booked", "1");
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.(30);
        }
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      <div className="order-2 lg:order-1">
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Select label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l === "all" ? "All levels" : l}
              </option>
            ))}
          </Select>
          <Select label="Day" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {d === "all" ? "Any day" : d}
              </option>
            ))}
          </Select>
        </div>

        {byVenue.length === 0 && (
          <EmptyState
            image="/images/empty-ivory.jpg"
            copy="No sessions match — try widening the filters."
          />
        )}

        <div className="space-y-6">
          {byVenue.map(({ venue, rows }) => (
            <div key={venue?.id ?? "unknown"}>
              <p className="label mb-2">{venue?.name ?? "Venue TBC"}</p>
              <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
                {rows.map((s) => {
                  const left = s.capacity - s.confirmed;
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => openSheet(s)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-surface"
                      >
                        <div>
                          <p className="tnum font-medium">{fmtTime(s.starts_at)}</p>
                          <p className="text-sm text-fg-2">
                            {s.classTitle} · {s.durationMinutes} min
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <Badge>{s.level}</Badge>
                          <span
                            className={`tnum text-xs ${left <= 0 ? "text-err" : left <= 3 ? "text-ember" : "text-fg-2"}`}
                          >
                            {left <= 0 ? "FULL — waitlist" : `${left} left`}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="order-1 lg:order-2 lg:sticky lg:top-20 lg:self-start">
        <VenueMap venues={venues} height="42vh" interactiveCard={false} />
      </div>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.classTitle}
      >
        {selected && (
          <div className="space-y-5">
            <div>
              <p className="tnum font-display text-3xl">{fmtTime(selected.starts_at)}</p>
              <p className="mt-1 text-fg-2">
                {selected.venue?.name}
                {selected.coachName ? ` · Coach ${selected.coachName}` : ""}
              </p>
            </div>

            {/* capacity bar */}
            <div>
              <div className="mb-1 flex justify-between text-xs text-fg-2">
                <span>Capacity</span>
                <span className="tnum">
                  {selected.confirmed}/{selected.capacity}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-ember"
                  style={{
                    width: `${Math.min((selected.confirmed / selected.capacity) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>

            {players.length > 1 && (
              <Select
                label="Who's playing?"
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
              >
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </Select>
            )}

            {result?.ok ? (
              <div className="rounded-[12px] border border-ok p-4 text-center">
                <span
                  aria-hidden
                  className="ball-drop mx-auto mb-2 block h-4 w-4 rounded-full bg-ember"
                />
                <p className="font-medium">
                  {result.status === "confirmed"
                    ? "Booked. See you at the table."
                    : "You're on the waitlist — we'll tell you the moment a spot opens."}
                </p>
                <div className="mt-3 flex justify-center gap-3">
                  <a
                    href={`/api/ics/${result.bookingId}`}
                    className="text-sm text-ember underline-offset-4 hover:underline"
                  >
                    Add to calendar
                  </a>
                  <Link
                    href="/app/schedule"
                    className="text-sm text-ember underline-offset-4 hover:underline"
                  >
                    View schedule
                  </Link>
                </div>
                {pushState === null ? (
                  <button
                    onClick={async () => setPushState(await enablePush())}
                    className="mt-3 text-sm text-fg-2 underline-offset-4 hover:underline"
                  >
                    Want a reminder before your session?
                  </button>
                ) : (
                  <p className="mt-3 text-xs text-fg-2">
                    {pushState === "subscribed"
                      ? "Reminders on — we'll nudge you before each session."
                      : "We'll email your reminders instead."}
                  </p>
                )}
              </div>
            ) : !hasSubscription ? (
              <div className="space-y-3">
                <p className="text-sm text-fg-2">
                  You need an active membership to book this session.
                </p>
                <Link
                  href="/app/membership"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] bg-ember px-5 font-semibold text-ivory hover:bg-ember-2"
                >
                  Choose a plan
                </Link>
              </div>
            ) : (
              <>
                <Button onClick={book} disabled={pending || !playerId} className="w-full">
                  {pending ? (
                    <Spinner />
                  ) : selected.confirmed >= selected.capacity ? (
                    "Join waitlist"
                  ) : (
                    "Book this session"
                  )}
                </Button>
                {result && !result.ok && (
                  <p className="text-sm text-err">{result.error}</p>
                )}
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
