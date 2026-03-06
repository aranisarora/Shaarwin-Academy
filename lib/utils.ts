import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { DAY_TO_RRULE } from "@/lib/constants";
import { TIMEZONE } from "@/config/operating-hours";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Validates an Indian mobile number in E.164 format: +91 followed by 10 digits starting with 6–9 */
export function isValidIndianPhone(phone: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(phone.replace(/\s/g, ""));
}

/** Normalises a phone string to E.164 by stripping spaces */
export function normalisePhone(phone: string): string {
  return phone.replace(/\s/g, "");
}

export function generateRRule(dayCodes: string[], untilDate: Date): string {
  const rruleDays = dayCodes
    .map((day) => DAY_TO_RRULE[day] || day)
    .join(",");
  const until = untilDate
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return `RRULE:FREQ=WEEKLY;BYDAY=${rruleDays};UNTIL=${until}`;
}

export function getNextOccurrence(dayCodes: string[]): Date {
  const dayMap: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
  };

  const now = new Date();
  const today = now.getDay();

  let minDaysAhead = 7;
  for (const code of dayCodes) {
    const targetDay = dayMap[code];
    if (targetDay === undefined) continue;
    let daysAhead = (targetDay - today + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
    if (daysAhead < minDaysAhead) {
      minDaysAhead = daysAhead;
    }
  }

  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + minDaysAhead);
  return nextDate;
}

export function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours, 10);
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${displayHour}:${minutes} ${period}`;
}

// --- Event description helpers: maintain a user list ---
const ATTENDEE_LIST_HEADER = "--- Attendees ---";

interface AttendeeEntry {
  name: string;
  phone: string;
  status: "Present" | "Absent";
}

/** Build a fresh description with a single attendee */
export function buildEventDescription(name: string, phone: string): string {
  return `${ATTENDEE_LIST_HEADER}\n${name} | ${phone} | Present`;
}

/** Parse attendee entries from an event description */
export function parseAttendeeList(description: string | undefined): AttendeeEntry[] {
  if (!description) return [];
  const lines = description.split("\n");
  const headerIdx = lines.indexOf(ATTENDEE_LIST_HEADER);
  if (headerIdx === -1) return [];

  const entries: AttendeeEntry[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const parts = lines[i].split("|").map((s) => s.trim());
    if (parts.length >= 3) {
      entries.push({
        name: parts[0],
        phone: parts[1],
        status: parts[2] === "Absent" ? "Absent" : "Present",
      });
    }
  }
  return entries;
}

/** Serialize attendee entries back into a description string */
export function serializeAttendeeList(entries: AttendeeEntry[]): string {
  const lines = entries.map((e) => `${e.name} | ${e.phone} | ${e.status}`);
  return `${ATTENDEE_LIST_HEADER}\n${lines.join("\n")}`;
}

/** Add an attendee to an existing description (or create one) */
export function addAttendeeToDescription(
  description: string | undefined,
  name: string,
  phone: string
): string {
  const entries = parseAttendeeList(description);
  // Don't duplicate
  if (!entries.some((e) => e.name === name && e.phone === phone)) {
    entries.push({ name, phone, status: "Present" });
  }
  return serializeAttendeeList(entries);
}

/** Mark an attendee as absent in the description */
export function markAttendeeAbsent(
  description: string | undefined,
  email: string,
  attendees: { email: string; displayName?: string }[]
): string {
  const entries = parseAttendeeList(description);
  // Find the attendee name by email
  const match = attendees.find((a) => a.email === email);
  if (match?.displayName) {
    const entry = entries.find((e) => e.name === match.displayName);
    if (entry) entry.status = "Absent";
  }
  return serializeAttendeeList(entries);
}

/** Remove an attendee from the description */
export function removeAttendeeFromDescription(
  description: string | undefined,
  email: string,
  attendees: { email: string; displayName?: string }[]
): string {
  const entries = parseAttendeeList(description);
  const match = attendees.find((a) => a.email === email);
  const filtered = match?.displayName
    ? entries.filter((e) => e.name !== match.displayName)
    : entries;
  return serializeAttendeeList(filtered);
}

export function toISTDateTimeString(date: Date, time: string): string {
  const [hours, minutes] = time.split(":");
  const d = new Date(date);
  d.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
  return d.toLocaleString("sv-SE", { timeZone: TIMEZONE }).replace(" ", "T");
}
