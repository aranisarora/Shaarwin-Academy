// The founder's week, shaped for the cards — from bluetick's diary rows to what
// a card prints, and from a flat list to days.
//
// Bluetick's event is a title, a time, a host and a bag of attrs; the import
// writes `kind`, `venue`, `venue_unit` and `address` into that bag (see
// scripts/export-to-bluetick.mjs) and titles a private lesson "<player> private
// session". Everything the card needs is read here, once, with a fallback for
// each field, so a row the import did not write — one the assistant made in a
// conversation — still draws as a card rather than crashing the week.

import type { DiaryEvent } from "@/lib/bluetick";
import {
  formatWallDay,
  isoWallDate,
  sessionTimeStatus,
  type SessionTimeStatus,
} from "@/lib/academy-time";

/** Whose class this is — the one axis the cards colour by kind. */
export type ClassKind = "group" | "private" | "school";

export type SessionView = {
  id: string;
  /** ISO carrying the academy's own offset — see lib/bluetick.ts. */
  starts_at: string;
  ends_at: string | null;
  kind: ClassKind;
  /** "Adarsh Palm Retreat Villas", or the first line of a home address. */
  place: string | null;
  coach: string | null;
  /** The child on a private lesson, read off its title. */
  player: string | null;
  taken: number;
  capacity: number | null;
  cancelled: boolean;
  timing: SessionTimeStatus;
};

const PRIVATE_TITLE = /\s+private session$/i;

/** A lesson with no finish time is drawn as an hour long — every slot the
 *  academy runs is 60 minutes, and a card has to know when it is over. */
const HOUR_MS = 60 * 60 * 1000;

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function kindOf(e: DiaryEvent): ClassKind {
  const k = e.attrs.kind;
  if (k === "group" || k === "private" || k === "school") return k;
  if (e.attrs.school === true) return "school";
  if (PRIVATE_TITLE.test(e.title)) return "private";
  return "group";
}

function placeOf(e: DiaryEvent): string | null {
  const venue = text(e.attrs.venue);
  if (venue) {
    const unit = text(e.attrs.venue_unit);
    return unit ? `${venue} ${unit}` : venue;
  }
  const address = text(e.attrs.address);
  return address ? address.split(",")[0].trim() : null;
}

function playerOf(e: DiaryEvent): string | null {
  for (const t of [e.title, e.series_title]) {
    if (t && PRIVATE_TITLE.test(t)) return t.replace(PRIVATE_TITLE, "").trim() || null;
  }
  return null;
}

export function sessionView(e: DiaryEvent, now: number): SessionView {
  const kind = kindOf(e);
  const ends =
    e.ends_at ?? new Date(new Date(e.starts_at).getTime() + HOUR_MS).toISOString();
  return {
    id: e.id,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    kind,
    place: placeOf(e),
    coach: e.host?.label ?? null,
    player: kind === "private" ? playerOf(e) : null,
    taken: e.taken,
    capacity: e.capacity,
    cancelled: e.status === "cancelled",
    timing: sessionTimeStatus(e.starts_at, ends, now),
  };
}

export type DayGroup = {
  /** The academy wall date, "YYYY-MM-DD". */
  key: string;
  /** "Mon 14 Sep" — what the heading prints. */
  label: string;
  isToday: boolean;
  rows: SessionView[];
};

/**
 * Bucket the week by academy wall date, in calendar order, each day in time
 * order. Within a day, finished sessions sink to the bottom: at 4pm the founder
 * is looking for what is still to come, not what he already ran.
 */
export function groupByDay(rows: SessionView[], today: string): DayGroup[] {
  const byKey = new Map<string, DayGroup>();
  for (const s of rows) {
    const key = isoWallDate(s.starts_at);
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: formatWallDay(key), isToday: key === today, rows: [] };
      byKey.set(key, g);
    }
    g.rows.push(s);
  }
  const groups = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  const done = (s: SessionView) => s.timing === "completed";
  for (const g of groups) {
    g.rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    g.rows = [...g.rows.filter((s) => !done(s)), ...g.rows.filter(done)];
  }
  return groups;
}

export type DayDensity = {
  date: string;
  /** Sessions still standing. */
  live: number;
  /** Sessions called off — shown, because a hole you can't explain is worse. */
  cancelled: number;
};

/** How full each day is — the week strip's whole job. */
export function dayDensity(rows: SessionView[]): DayDensity[] {
  const byDate = new Map<string, DayDensity>();
  for (const s of rows) {
    const date = isoWallDate(s.starts_at);
    let d = byDate.get(date);
    if (!d) {
      d = { date, live: 0, cancelled: 0 };
      byDate.set(date, d);
    }
    if (s.cancelled) d.cancelled += 1;
    else d.live += 1;
  }
  return [...byDate.values()];
}
