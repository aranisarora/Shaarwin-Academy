// Shared shapes for the merged admin calendar (week view + class management
// + add flows). The page assembles these rows server-side; the client sheets
// mutate through the calendar server actions.

import type { StructuredAddress } from "@/lib/address";


export type SessionRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  // Cancelled sessions used to be filtered out of the query, so a called-off
  // class simply vanished and Tuesday read as a day we don't run. They are
  // fetched now and shown as cancelled — see lib/session-deviation.ts.
  status: "scheduled" | "completed" | "cancelled";
  cancelReason: string | null;
  coachId: string | null;
  coachArrivedAt: string | null;
  coachArrivalSource: string | null; // 'auto' | 'tap' | 'wa' — how arrival was marked
  coachArrivalDistanceM: number | null; // metres from the venue at arrival, if known
  // What the session is still waiting on after it ran. Same definitions the
  // database chases coaches with — see lib/session-followthrough.ts. Both are 0
  // for a session with nothing booked against it, which is the honest answer:
  // a school class registered in the hall has no online roster to keep.
  rosterUnmarked: number; // bookings still on 'confirmed' — register never kept
  assessPending: number; // attended players with no assessment for this session
  title: string;
  capacity: number; // effective for this session (override ?? class default)
  isPrivate: boolean;
  isSchool: boolean; // group class held at a school — coaches/admins add players
  venueName: string | null;
  // The CLIENT — the account that pays, i.e. the parent. Badly named for
  // history's sake: the calendar's client filter and the "cancel all private
  // sessions for …" prompt both read it as the client, which is what it is.
  playerName: string | null;
  // The PLAYER — the child who actually turns up. This is the name the founder
  // is looking for on a card, so it is what the cards show.
  privatePlayerName: string | null;
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
  classTime: string; // HH:MM — the NEXT session's wall time; seeds the class editor
  // HH:MM — the slot this class actually keeps, as the mode over its own
  // sessions. Distinct from classTime on purpose: "the next one" is wrong
  // exactly when the next one is the session that moved, which is the case this
  // field exists to catch. Null for a one-off, which has no pattern to keep.
  classSlotTime: string | null;
  classRecurring: boolean; // has a recurrence rule — i.e. edited on the timetable
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

/**
 * One row of a player-first picker. The founder thinks in players — the child
 * who turns up — and only needs the client (the account that pays) to tell two
 * Rohans apart, so the player leads and the family name follows in brackets.
 * Picking a client and then picking their player was two decisions for one
 * thought, and the second one only ever appeared for families with more than
 * one child, so the same job looked different from one booking to the next.
 *
 * `value` carries both ids because the actions underneath still take both:
 * "clientId" on its own for a family whose player profile doesn't exist yet,
 * "clientId|playerId" otherwise. Uuids contain no "|", so the split is safe.
 */
export type PlayerChoice = { value: string; label: string };

/** Every player across every client, as "Player (Family)" rows sorted by the
 * name the founder is scanning for. A client with no player yet still gets a
 * row: dropping them would quietly make a family unbookable from a picker that
 * used to list them. */
export function playerChoices(clients: ClientOption[]): PlayerChoice[] {
  const rows: PlayerChoice[] = [];
  for (const c of clients) {
    const clientName = c.name || "Unnamed client";
    if (c.players.length === 0) {
      rows.push({ value: c.id, label: `${clientName} — no player yet` });
      continue;
    }
    for (const p of c.players) {
      rows.push({ value: `${c.id}|${p.id}`, label: `${p.name} (${clientName})` });
    }
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** Split a picker value back into the ids the server actions take. Values that
 * aren't a player row at all ("open", "invite:…") come back as the client half
 * with no player, which is exactly how the callers already read them. */
export function splitPlayerChoice(value: string): { clientId: string; playerId: string } {
  const [clientId, playerId = ""] = value.split("|");
  return { clientId, playerId };
}

/** The picker value for a client/player pair already held in state. */
export function playerChoiceValue(clientId: string, playerId: string): string {
  return playerId ? `${clientId}|${playerId}` : clientId;
}

export type Coach = { id: string; name: string };
export type Venue = {
  id: string;
  name: string;
  /** Which part of a complex this is ("Villas", "Apartments"). Null when the
   *  venue is the whole place. Always render via venueDisplayName. */
  unit: string | null;
  /** Offered to clients: listed on the website and pickable when booking (0081). */
  is_public: boolean;
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
