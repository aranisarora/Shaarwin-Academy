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
import { bookSlot, type BookSlotResult } from "@/app/app/book/actions";
import { enablePush, type PushState } from "@/lib/push";
import type { BrowseSession } from "@/lib/booking";
import type { Venue } from "@/lib/data";

const LEVELS = ["all", "beginner", "intermediate", "advanced", "elite"] as const;
const WEEKDAYS = ["all", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const TZ = "Asia/Kolkata";

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).format(new Date(iso));
}

/** Wall-clock parts of a session in the academy timezone. */
function slotParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday"); // "Monday"
  const time = `${get("hour")}:${get("minute")} ${get("dayPeriod")}`; // "5:00 pm"
  return { weekday, weekdayShort: weekday.slice(0, 3), time };
}

const PLURAL: Record<string, string> = {
  Monday: "Mondays",
  Tuesday: "Tuesdays",
  Wednesday: "Wednesdays",
  Thursday: "Thursdays",
  Friday: "Fridays",
  Saturday: "Saturdays",
  Sunday: "Sundays",
};

type Slot = {
  key: string;
  next: BrowseSession; // earliest upcoming occurrence
  weekday: string;
  weekdayShort: string;
  time: string;
  occurrences: number; // future occurrences visible in the browse window
};

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
  const [selected, setSelected] = useState<Slot | null>(null);
  const [recurring, setRecurring] = useState(true);
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [result, setResult] = useState<BookSlotResult | null>(null);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pending, startTransition] = useTransition();

  // Collapse dated instances into recurring slots (class + weekday + time).
  // `sessions` arrives sorted by starts_at, so the first hit is the next one.
  const slots = useMemo(() => {
    const map = new Map<string, Slot>();
    for (const s of sessions) {
      if (level !== "all" && s.level !== level) continue;
      const p = slotParts(s.starts_at);
      if (weekday !== "all" && p.weekdayShort !== weekday) continue;
      const key = `${s.classId}|${p.weekday}|${p.time}`;
      const existing = map.get(key);
      if (existing) {
        existing.occurrences += 1;
      } else {
        map.set(key, {
          key,
          next: s,
          weekday: p.weekday,
          weekdayShort: p.weekdayShort,
          time: p.time,
          occurrences: 1,
        });
      }
    }
    return [...map.values()];
  }, [sessions, level, weekday]);

  const byVenue = useMemo(() => {
    const map = new Map<string, { venue: BrowseSession["venue"]; rows: Slot[] }>();
    for (const slot of slots) {
      const v = slot.next.venue;
      const key = v?.id ?? "unknown";
      const entry = map.get(key) ?? { venue: v, rows: [] };
      entry.rows.push(slot);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [slots]);

  function openSheet(slot: Slot) {
    setResult(null);
    setRecurring(true);
    setSelected(slot);
  }

  function book() {
    if (!selected || !playerId) return;
    startTransition(async () => {
      const r = await bookSlot(selected.next.id, playerId, recurring);
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
        <p className="mb-4 text-sm text-fg-2">
          Pick a weekly slot — booking holds your place{" "}
          <span className="text-fg">every week</span>. You can switch to a one-off
          when you book.
        </p>

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
            copy="No slots match — try widening the filters."
          />
        )}

        <div className="space-y-6">
          {byVenue.map(({ venue, rows }) => (
            <div key={venue?.id ?? "unknown"}>
              <p className="label mb-2">{venue?.name ?? "Venue TBC"}</p>
              <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
                {rows.map((slot) => {
                  const s = slot.next;
                  const left = s.capacity - s.confirmed;
                  return (
                    <li key={slot.key}>
                      <button
                        onClick={() => openSheet(slot)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-surface"
                      >
                        <div>
                          <p className="tnum font-medium">
                            {PLURAL[slot.weekday] ?? slot.weekday} · {slot.time}
                          </p>
                          <p className="text-sm text-fg-2">
                            {s.classTitle} · {s.durationMinutes} min · next {fmtDate(s.starts_at)}
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
        <VenueMap venues={venues} height="42vh" interactiveCard={false} autoLocate />
      </div>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.next.classTitle}
      >
        {selected && (
          <div className="space-y-5">
            <div>
              <p className="tnum font-display text-3xl">
                {PLURAL[selected.weekday] ?? selected.weekday} · {selected.time}
              </p>
              <p className="mt-1 text-fg-2">
                {selected.next.venue?.name}
                {selected.next.coachName ? ` · Coach ${selected.next.coachName}` : ""}
              </p>
              <p className="mt-1 text-sm text-fg-2">
                Starting {fmtDate(selected.next.starts_at)}
              </p>
            </div>

            {/* capacity bar (next occurrence) */}
            <div>
              <div className="mb-1 flex justify-between text-xs text-fg-2">
                <span>Next session</span>
                <span className="tnum">
                  {selected.next.confirmed}/{selected.next.capacity}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-ember"
                  style={{
                    width: `${Math.min((selected.next.confirmed / selected.next.capacity) * 100, 100)}%`,
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

            {/* Recurring vs one-off — recurring is the default. */}
            {!result?.ok && hasSubscription && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRecurring(true)}
                  aria-pressed={recurring}
                  className={`rounded-[10px] border p-3 text-left ${recurring ? "border-ember bg-ember/5" : "border-line hover:border-fg-2"}`}
                >
                  <p className="text-sm font-semibold">Every week</p>
                  <p className="mt-0.5 text-xs text-fg-2">
                    Hold {PLURAL[selected.weekday] ?? selected.weekday} at {selected.time},
                    ongoing.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setRecurring(false)}
                  aria-pressed={!recurring}
                  className={`rounded-[10px] border p-3 text-left ${!recurring ? "border-ember bg-ember/5" : "border-line hover:border-fg-2"}`}
                >
                  <p className="text-sm font-semibold">Just once</p>
                  <p className="mt-0.5 text-xs text-fg-2">
                    Only {fmtDate(selected.next.starts_at)}.
                  </p>
                </button>
              </div>
            )}

            {result?.ok ? (
              <div className="rounded-[12px] border border-ok p-4 text-center">
                <span
                  aria-hidden
                  className="ball-drop mx-auto mb-2 block h-4 w-4 rounded-full bg-ember"
                />
                <p className="font-medium">
                  {result.recurring
                    ? `You're in — ${PLURAL[selected.weekday] ?? selected.weekday} at ${selected.time}, every week.`
                    : result.firstStatus === "confirmed"
                      ? "Booked. See you at the table."
                      : "You're on the waitlist — we'll tell you the moment a spot opens."}
                </p>
                {result.recurring && (
                  <p className="mt-1 text-sm text-fg-2">
                    {result.confirmed} session{result.confirmed === 1 ? "" : "s"} confirmed
                    {result.waitlisted > 0 ? `, ${result.waitlisted} waitlisted` : ""}. New
                    weeks are booked automatically — manage it from your schedule.
                  </p>
                )}
                {pushState === null ? (
                  <button
                    onClick={async () => setPushState(await enablePush())}
                    className="mt-3 text-sm text-fg-2 underline-offset-4 hover:underline"
                  >
                    Want a reminder before your sessions?
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
                  You need an active membership to book this slot.
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
                  ) : selected.next.confirmed >= selected.next.capacity ? (
                    "Join waitlist"
                  ) : recurring ? (
                    `Book ${PLURAL[selected.weekday] ?? selected.weekday} at ${selected.time}`
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
