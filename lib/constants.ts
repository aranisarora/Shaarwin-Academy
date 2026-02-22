export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

import type { DayCode } from "@/types/database";

export const DAY_CODES: Record<DayCode, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
};

export const DAY_TO_RRULE: Record<string, string> = {
  Sunday: "SU",
  Monday: "MO",
  Tuesday: "TU",
  Wednesday: "WE",
  Thursday: "TH",
  Friday: "FR",
  Saturday: "SA",
};

export const BOOKING_DURATION_MONTHS = 4;

export const CLASS_TYPES = {
  GROUP: "group",
  PRIVATE: "private",
} as const;
