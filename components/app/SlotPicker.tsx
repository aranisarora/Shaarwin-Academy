"use client";

// The two-level private-booking time picker (the Uber/Calendly pattern): pick a
// day first, then a time within it, instead of scrolling one flat wall of 60
// date-time buttons. Two modes share the same shell:
//   • "dates"  — one-off booking: day pills → time chips for that day.
//   • "weekly" — plan client: weekday pills → the deduped weekly times, each
//                labelled by its recurring identity ("5:00 pm · starts 4 Aug").
// All formatting is Asia/Kolkata via Intl — never the device timezone.

import { useMemo, useState } from "react";
import type { Slot } from "@/app/app/book/private/actions";

type Mode = "dates" | "weekly";

// ── IST formatting helpers ────────────────────────────────────────────────
const IST = "Asia/Kolkata";

/** YYYY-MM-DD wall date in IST — the grouping key for one-off day pills. */
function istDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** "Today" / "Tomorrow" / "Wed" — the day-pill label. One-off mode only ever
 * shows the next 7 days, so a bare weekday is unambiguous and stays narrow
 * enough that a whole week of pills fits a phone with little to no scroll. */
function dayPillLabel(iso: string, todayKey: string, tomorrowKey: string) {
  const key = istDateKey(iso);
  if (key === todayKey) return "Today";
  if (key === tomorrowKey) return "Tomorrow";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: IST,
  }).format(new Date(iso));
}

/** "Wed 30 Jul" — used inside one-off selection chips. */
function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: IST,
  }).format(new Date(iso));
}

/** "5:00 pm" — time-only chip label. */
function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(new Date(iso));
}

/** "starts 4 Aug" — the series start date shown under a weekly time. */
function startLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: IST,
  }).format(new Date(iso));
}

/** "Mon"…"Sun" — weekday-pill key/label for weekly mode. */
function weekdayShort(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: IST,
  }).format(new Date(iso));
}

/** "Tuesdays" — the recurring identity used in weekly selection chips. */
function weekdayPlural(iso: string) {
  return (
    new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: IST }).format(
      new Date(iso)
    ) + "s"
  );
}

/** IST weekday+time key so two dates of the same weekly slot collide. */
function weeklyKey(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST,
  }).format(new Date(iso));
}

/** 0–23 IST hour, for morning/afternoon/evening bucketing. */
function istHour(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: IST,
    }).format(new Date(iso))
  );
}

function partOfDay(iso: string): "Morning" | "Afternoon" | "Evening" {
  const h = istHour(iso);
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

const pill =
  "min-h-11 shrink-0 snap-start rounded-full border px-4 text-sm font-semibold transition-colors";
const chip =
  "min-h-11 rounded-[8px] border px-2 text-sm transition-colors disabled:opacity-40";
const on = "border-ember bg-ember text-ivory";
const off = "border-line hover:border-ember";

export function SlotPicker({
  slots,
  mode,
  selected,
  maxSlots,
  onToggle,
}: {
  slots: Slot[];
  mode: Mode;
  selected: string[];
  maxSlots: number;
  onToggle: (startsAt: string) => void;
}) {
  // Level-1 buckets (days or weekdays). In weekly mode each bucket's times are
  // deduped to one representative per weekday+time — the earliest date, which
  // is the series start create_private_series derives weekday/time from.
  const groups = useMemo(() => {
    const sorted = [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    if (mode === "weekly") {
      const seen = new Set<string>();
      const byWeekday = new Map<string, string[]>();
      for (const s of sorted) {
        const wk = weeklyKey(s.starts_at);
        if (seen.has(wk)) continue; // keep only the earliest date per weekly slot
        seen.add(wk);
        const day = weekdayShort(s.starts_at);
        (byWeekday.get(day) ?? byWeekday.set(day, []).get(day)!).push(s.starts_at);
      }
      return [...byWeekday.entries()].map(([key, times]) => ({ key, times }));
    }
    const byDay = new Map<string, string[]>();
    for (const s of sorted) {
      const day = istDateKey(s.starts_at);
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(s.starts_at);
    }
    // One-off mode only offers the next 7 days — a two-week horizontal scroll
    // is awkward on a phone and rarely needed for a soon booking.
    return [...byDay.entries()].slice(0, 7).map(([key, times]) => ({ key, times }));
  }, [slots, mode]);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Default to the first bucket, and self-heal if the active one disappears
  // after a duration change re-fetches a different slot set.
  const active =
    groups.find((g) => g.key === activeKey) ?? groups[0] ?? null;

  const atCap = selected.length >= maxSlots;

  // IST wall-date keys for the "Today"/"Tomorrow" pill labels (IST has no DST,
  // so a flat +24h step is exact).
  const now = Date.now();
  const todayKey = istDateKey(new Date(now).toISOString());
  const tomorrowKey = istDateKey(new Date(now + 86_400_000).toISOString());

  if (groups.length === 0) return null;

  const times = active?.times ?? [];
  // Only bucket into Morning/Afternoon/Evening when the day is long enough that
  // flat rows get hard to scan.
  const bucketed = mode === "dates" && times.length > 8;

  return (
    <div className="space-y-3">
      {/* Level 1 — day / weekday selector */}
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        {groups.map((g) => {
          const isActive = active?.key === g.key;
          const label =
            mode === "weekly"
              ? g.key
              : dayPillLabel(g.times[0], todayKey, tomorrowKey);
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setActiveKey(g.key)}
              aria-pressed={isActive}
              className={`${pill} ${isActive ? on : off}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Level 2 — times for the active day */}
      <div className="max-h-72 overflow-y-auto pr-1">
        {bucketed
          ? (["Morning", "Afternoon", "Evening"] as const).map((part) => {
              const partTimes = times.filter((t) => partOfDay(t) === part);
              if (partTimes.length === 0) return null;
              return (
                <div key={part} className="mb-3">
                  <p className="label mb-1.5">{part}</p>
                  <TimeGrid
                    times={partTimes}
                    mode={mode}
                    selected={selected}
                    atCap={atCap}
                    onToggle={onToggle}
                  />
                </div>
              );
            })
          : (
            <TimeGrid
              times={times}
              mode={mode}
              selected={selected}
              atCap={atCap}
              onToggle={onToggle}
            />
          )}
      </div>

      {/* Running selection — removable, so picks on other days aren't lost. */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {[...selected]
            .sort((a, b) => a.localeCompare(b))
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onToggle(s)}
                className="tnum inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ember bg-ember/10 px-3 text-xs font-medium text-ember"
              >
                {mode === "weekly"
                  ? `${weekdayPlural(s)} · ${timeLabel(s)}`
                  : `${dayLabel(s)} · ${timeLabel(s)}`}
                <span aria-hidden>✕</span>
                <span className="sr-only">Remove</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function TimeGrid({
  times,
  mode,
  selected,
  atCap,
  onToggle,
}: {
  times: string[];
  mode: Mode;
  selected: string[];
  atCap: boolean;
  onToggle: (startsAt: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {times.map((t) => {
        const isSelected = selected.includes(t);
        const disabled = !isSelected && atCap;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            disabled={disabled}
            aria-pressed={isSelected}
            title={disabled ? "You've reached your limit" : undefined}
            className={`${chip} tnum ${isSelected ? on : off}`}
          >
            <span className="block leading-tight">{timeLabel(t)}</span>
            {mode === "weekly" && (
              <span className="block text-[0.65rem] leading-tight text-current opacity-70">
                starts {startLabel(t)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
