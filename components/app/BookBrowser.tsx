"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  formatClock,
  formatSessionDate,
  formatWeekdayLong,
} from "@/lib/academy-time";
import { VenueMap } from "@/components/marketing/VenueMap";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar } from "@/components/ui/FilterBar";
import { bookSlot, type BookSlotResult } from "@/app/app/book/actions";
import { WhatsAppSayHi } from "@/components/app/WhatsAppSayHi";
import { useIsDesktop } from "@/components/app/use-pwa";
import type { BrowseSession } from "@/lib/booking";
import type { Venue } from "@/lib/data";

const LEVELS = ["all", "beginner", "intermediate", "advanced", "elite"] as const;
const WEEKDAYS = ["all", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const fmtDate = formatSessionDate;

/** Wall-clock parts of a session in the academy timezone. */
function slotParts(iso: string) {
  const weekday = formatWeekdayLong(iso); // "Monday"
  return { weekday, weekdayShort: weekday.slice(0, 3), time: formatClock(iso) };
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

/** How a client without a group plan can still book: trial or drop-in. */
export type GroupEntitlement = {
  hasGroupPlan: boolean;
  trialPlayerIds: string[];
  /** Players whose trial has already been consumed — distinguishes "used" from "never had". */
  usedTrialPlayerIds: string[];
  dropinCredits: number;
};

export function BookBrowser({
  sessions,
  venues,
  players,
  entitlement,
  onboarding = false,
}: {
  sessions: BrowseSession[];
  venues: Venue[];
  players: { id: string; full_name: string }[];
  entitlement: GroupEntitlement;
  /** Reached from the onboarding flow — success routes to the install screen. */
  onboarding?: boolean;
}) {
  const [level, setLevel] = useState<string>("all");
  const [weekday, setWeekday] = useState<string>("all");
  // On the phone the venue map is folded behind a chip so the slot list is the
  // first content; on desktop the sidebar map is always shown (see useIsDesktop).
  const [mapOpen, setMapOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const [selected, setSelected] = useState<Slot | null>(null);
  const [recurring, setRecurring] = useState(entitlement.hasGroupPlan);
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [result, setResult] = useState<BookSlotResult | null>(null);
  const [pending, startTransition] = useTransition();

  const { hasGroupPlan } = entitlement;
  // Without a plan, a single session can ride on the player's free trial or a
  // purchased drop-in credit (the server consumes trial first).
  const credit: "trial" | "dropin" | null = hasGroupPlan
    ? null
    : entitlement.trialPlayerIds.includes(playerId)
      ? "trial"
      : entitlement.dropinCredits > 0
        ? "dropin"
        : null;
  const canBook = hasGroupPlan || credit !== null;
  const trialUsed = entitlement.usedTrialPlayerIds.includes(playerId);
  const playerName =
    players.find((p) => p.id === playerId)?.full_name ?? "your player";

  // Collapse dated instances into recurring slots (class + weekday + time).
  // `sessions` arrives sorted by starts_at, so the first hit is the next one.
  const slots = useMemo(() => {
    const map = new Map<string, Slot>();
    for (const s of sessions) {
      if (level !== "all" && s.level !== level && s.level !== "any") continue;
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
    setRecurring(hasGroupPlan);
    setSelected(slot);
  }

  function book() {
    if (!selected || !playerId) return;
    startTransition(async () => {
      const r = await bookSlot(selected.next.id, playerId, recurring && hasGroupPlan);
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
      {/* Intro + filters (row 1, left column on desktop) */}
      <div className="order-1 min-w-0 lg:col-start-1 lg:row-start-1">
        {hasGroupPlan ? (
          <p className="mb-4 text-sm text-fg-2">
            Pick a weekly slot — booking holds your place{" "}
            <span className="text-fg">every week</span>. You can switch to a
            one-time class when you book.
          </p>
        ) : (
          <p className="mb-4 text-sm text-fg-2">
            Pick a slot for a single class.{" "}
            <span className="text-fg">Members hold their place every week</span>{" "}
            — plans are on the membership page.
          </p>
        )}

        <FilterBar
          filters={[
            {
              key: "level",
              aria: "Filter by level",
              label: "All levels",
              value: level,
              onChange: setLevel,
              options: LEVELS.map((l) => ({
                value: l,
                label: l === "all" ? "All levels" : l[0].toUpperCase() + l.slice(1),
              })),
            },
            {
              key: "day",
              aria: "Filter by day",
              label: "Any day",
              value: weekday,
              onChange: setWeekday,
              options: WEEKDAYS.map((d) => ({
                value: d,
                label: d === "all" ? "Any day" : d,
              })),
            },
          ]}
          trailing={
            <button
              type="button"
              onClick={() => setMapOpen((v) => !v)}
              aria-pressed={mapOpen}
              className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full border py-1.5 pl-3.5 pr-3 text-sm font-medium ${
                mapOpen ? "border-ember text-ember" : "border-line text-fg-2"
              }`}
            >
              Map
              <span aria-hidden className="ml-1 text-xs opacity-70">
                ▾
              </span>
            </button>
          }
        />
      </div>

      {/* Venue map — folded behind the chip on mobile, sticky sidebar on desktop.
          Rendered once (never a hidden second Mapbox instance). */}
      {(isDesktop || mapOpen) && (
        <div className="order-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-20 lg:self-start">
          <VenueMap venues={venues} height="42vh" interactiveCard={false} autoLocate />
        </div>
      )}

      {/* Slot list — the first real content on the phone (row 2, left column) */}
      <div className="order-3 min-w-0 lg:col-start-1 lg:row-start-2">
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
                  const bookedHere = s.myBookings.length > 0;
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
                          <Badge>{s.level === "any" ? "all levels" : s.level}</Badge>
                          {bookedHere ? (
                            <span className="tnum text-xs text-ok">booked</span>
                          ) : (
                            <span
                              className={`tnum text-xs ${left <= 0 ? "text-err" : left <= 3 ? "text-ember" : "text-fg-2"}`}
                            >
                              {left <= 0 ? "FULL — waitlist" : `${left} left`}
                            </span>
                          )}
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
                Starting {fmtDate(selected.next.starts_at)} ·{" "}
                {selected.next.level === "any" ? "all levels" : selected.next.level}
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
              <div>
                <p className="label mb-2">Who&apos;s playing?</p>
                {players.length <= 4 ? (
                  // A quick household picker — no dropdown to open for two or
                  // three kids. Falls back to a select once the list is long.
                  <div className="flex flex-wrap gap-2">
                    {players.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlayerId(p.id)}
                        aria-pressed={playerId === p.id}
                        className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                          playerId === p.id
                            ? "border-ember bg-ember/5 text-ember"
                            : "border-line text-fg-2 hover:border-ember"
                        }`}
                      >
                        {p.full_name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <Select
                    aria-label="Who's playing?"
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
              </div>
            )}

            {/* Recurring vs one-off — recurring is the default for members. */}
            {!result?.ok && hasGroupPlan && (
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

            {(() => {
              // Booking the selected player already holds for this specific session.
              const existingBooking = selected.next.myBookings.find(
                (b) => b.playerId === playerId || b.playerId === null
              ) ?? null;

              if (result?.ok) {
                return (
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
                    <div className="mt-4">
                      <WhatsAppSayHi label="Want a reminder?" />
                    </div>
                    {onboarding && (
                      <Link
                        href="/app/onboarding/done"
                        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] bg-ember px-5 font-semibold text-ivory hover:bg-ember-2"
                      >
                        Continue — finish setup
                      </Link>
                    )}
                  </div>
                );
              }

              if (existingBooking) {
                return (
                  <div className="rounded-[12px] border border-ok p-4 text-center">
                    <span
                      aria-hidden
                      className="ball-drop mx-auto mb-2 block h-4 w-4 rounded-full bg-ember"
                    />
                    <p className="font-medium">
                      {existingBooking.status === "confirmed"
                        ? "You're booked for this session."
                        : "You're on the waitlist for this session."}
                    </p>
                    <Link
                      href="/app/schedule"
                      className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] bg-surface-2 px-5 font-semibold hover:bg-surface"
                    >
                      View in schedule
                    </Link>
                  </div>
                );
              }

              if (!canBook) {
                return (
                  <div className="space-y-3">
                    <p className="text-sm text-fg-2">
                      {trialUsed
                        ? `${playerName}'s free trial has been used. Get a membership to book weekly, or buy a drop-in class.`
                        : "You need a membership or a drop-in class to book this slot."}
                    </p>
                    <Link
                      href="/app/membership"
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] bg-ember px-5 font-semibold text-ivory hover:bg-ember-2"
                    >
                      See plans &amp; drop-ins
                    </Link>
                  </div>
                );
              }

              return (
                <>
                  {credit === "trial" && (
                    <div className="rounded-[10px] border border-ok bg-surface-2 p-3 text-sm">
                      <p className="font-semibold">
                        {playerName}&apos;s first class is free — on us. 🎉
                      </p>
                      <p className="mt-0.5 text-fg-2">
                        This booking uses the free trial. No payment needed.
                      </p>
                    </div>
                  )}
                  {credit === "dropin" && (
                    <p className="text-sm text-fg-2">
                      Uses 1 of your {entitlement.dropinCredits} drop-in{" "}
                      {entitlement.dropinCredits === 1 ? "class" : "classes"}.
                    </p>
                  )}
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
              );
            })()}
          </div>
        )}
      </Sheet>
    </div>
  );
}
