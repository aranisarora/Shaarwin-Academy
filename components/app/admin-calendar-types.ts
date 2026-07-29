// Shared shapes for the merged admin calendar (week view + class management
// + add flows). The page assembles these rows server-side; the client sheets
// mutate through the calendar server actions.

import type { StructuredAddress } from "@/lib/address";


export type SessionRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  coachId: string | null;
  coachArrivedAt: string | null;
  coachArrivalSource: string | null; // 'auto' | 'tap' | 'wa' — how arrival was marked
  coachArrivalDistanceM: number | null; // metres from the venue at arrival, if known
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
  classRecurring: boolean; // has a recurrence rule — i.e. edited in Weekly classes
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
  coachName: string | null; // coach on the next scheduled session, if any
  // How full the next upcoming session is — lets the founder scan for room at a
  // glance, like reading his WhatsApp groups. bookedCount is players confirmed
  // on that next session; capacity is the class default.
  bookedCount: number;
  // The next upcoming session — drives the class sheet's "Regulars" list, the
  // "Open this week's session →" cross-link, and the view-as-coach shortcut.
  nextSessionId: string | null;
  nextSessionStart: string | null; // ISO
  nextCoachId: string | null;
};

/**
 * An active client weekly private booking (private_booking_series), surfaced on
 * the Weekly classes tab under the same location grouping as group classes.
 * View-only: rows deep-link to the next generated session on the Schedule tab.
 */
export type PrivateSeriesRow = {
  id: string;
  playerName: string;
  clientName: string; // family / client name, for the sub-line
  weekday: string; // MO..SU (from the series' ISO weekday)
  time: string; // HH:MM IST wall clock
  duration: number;
  coachName: string | null; // preferred coach, if set
  // The resolved location name it groups under — a curated venue's name when
  // the pin/address matches one, else the client-home location label.
  venueName: string;
  // Whether venueName matches a curated venue (venue badge) or is a pure
  // private location (private badge).
  knownVenue: boolean;
  nextSessionId: string | null;
  nextSessionStart: string | null; // ISO — for the ?date= deep-link
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
  address_details: Partial<StructuredAddress> | null;
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

/** How a coach's arrival was captured, for the schedule sheet. */
export function arrivalSourceLabel(source: string): string {
  if (source === "auto") return "auto";
  if (source === "wa") return "WhatsApp";
  return "tap";
}

/** Distance to the venue at arrival — "40 m" under a km, else "3.2 km". */
export function fmtDistance(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
}
