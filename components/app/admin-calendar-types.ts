// Shared shapes for the merged admin calendar (week view + class management
// + add flows). The page assembles these rows server-side; the client sheets
// mutate through the calendar server actions.

import type { StructuredAddress } from "@/lib/address";

export { sessionTimeStatus, type SessionTimeStatus } from "@/lib/academy-time";

export type SessionRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  coachId: string | null;
  coachArrivedAt: string | null;
  title: string;
  capacity: number; // effective for this session (override ?? class default)
  isPrivate: boolean;
  isSchool: boolean; // group class held at a school — coaches/admins add players
  venueName: string | null;
  playerName: string | null;
  // For private sessions: the assigned client, or null for an "open" slot held
  // without a client yet. Drives the "unassigned" label and the assign action.
  privateClientId: string | null;
  address: StructuredAddress | null;
  // Class scope — what "every week" edits apply to. Present on group sessions.
  classId: string;
  classActive: boolean;
  classDescription: string;
  classLevel: string;
  classCapacity: number;
  classDuration: number;
  classVenueId: string | null;
  classWeekday: string; // MO..SU from the recurrence rule
  classTime: string; // HH:MM canonical slot (next session's wall time)
};

export type ClassRow = {
  id: string;
  title: string;
  description: string;
  level: string;
  capacity: number;
  duration: number;
  weekday: string; // MO..SU
  time: string; // HH:MM academy wall clock
  active: boolean;
  endsOn: string | null; // set when the class was ended — restorable
  venueId: string | null;
  venueName: string | null;
  isSchool: boolean; // held at a school — not bookable online
};

export type Coach = { id: string; name: string };
export type Venue = {
  id: string;
  name: string;
  active: boolean;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  address_details: Record<string, unknown> | null;
};
export type ClientOption = {
  id: string;
  name: string;
  players: { id: string; name: string }[];
};

/** A pre-registered client (phone invite, no account yet). */
export type InviteOption = {
  id: string;
  name: string;
  phone: string;
};

export const WEEKDAYS = [
  ["MO", "Monday"], ["TU", "Tuesday"], ["WE", "Wednesday"],
  ["TH", "Thursday"], ["FR", "Friday"], ["SA", "Saturday"], ["SU", "Sunday"],
] as const;

export const WEEKDAY_NAME: Record<string, string> = Object.fromEntries(WEEKDAYS);

/** MO..SU for a YYYY-MM-DD wall-clock date (weekday of a calendar date is
 * timezone-independent). */
export function weekdayOfDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][new Date(y, m - 1, d).getDay()];
}

/** "Mon 14 Jul" — day header for grouping the week view by day. */
export function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

/** "Sat 12 Jul, 6:30 pm" — display formatting in academy time. */
export function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

/** YYYY-MM-DD academy wall date — feeds <input type="date">. */
export function wallDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** 24-hour "HH:MM" — feeds <input type="time">, which requires it. */
export function wallTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 12-hour "5:00 pm" — for display. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}
