export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  recurrence?: string[];
  attendees?: CalendarAttendee[];
  status?: string;
  htmlLink?: string;
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
  recurrence?: string[];
  attendees?: { email: string; displayName?: string }[];
  calendarId?: string;
}

export interface UserScheduleEvent {
  id: string;
  summary: string;
  startTime: string;
  endTime: string;
  calendarId: string;
  attendeeStatus: string;
  isRecurring: boolean;
}
