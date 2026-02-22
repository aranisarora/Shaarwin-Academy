import { google } from "googleapis";
import type { CreateEventInput, CalendarEvent, UserScheduleEvent } from "@/types/calendar";
import { TIMEZONE } from "@/config/operating-hours";

/**
 * Using OAuth2 for authentication. 
 * This allows the app to act on behalf of your personal Gmail account,
 * solving the "Service accounts cannot invite attendees" error.
 */
function getAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  return oauth2Client;
}

function getCalendar() {
  const auth = getAuth();
  return google.calendar({ version: "v3", auth });
}

const DEFAULT_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!;

export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
  const calendar = getCalendar();
  const targetCalendarId = input.calendarId || DEFAULT_CALENDAR_ID;

  if (!targetCalendarId) {
    throw new Error("❌ CRITICAL: GOOGLE_CALENDAR_ID is not defined in .env");
  }

  const event = await calendar.events.insert({
    calendarId: targetCalendarId,
    sendUpdates: "all", // Ensures attendees receive email invitations
    requestBody: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: {
        dateTime: input.startDateTime,
        timeZone: input.timeZone || TIMEZONE,
      },
      end: {
        dateTime: input.endDateTime,
        timeZone: input.timeZone || TIMEZONE,
      },
      recurrence: input.recurrence,
      attendees: input.attendees?.map((a) => ({
        email: a.email,
        displayName: a.displayName,
      })),
    },
  });

  return event.data as unknown as CalendarEvent;
}

export async function getEvent(
  eventId: string,
  calendarId: string = DEFAULT_CALENDAR_ID
): Promise<CalendarEvent> {
  const calendar = getCalendar();

  const event = await calendar.events.get({
    calendarId,
    eventId,
  });

  return event.data as unknown as CalendarEvent;
}

export async function updateEventAttendees(
  eventId: string,
  attendees: { email: string; responseStatus?: string }[],
  calendarId: string = DEFAULT_CALENDAR_ID
): Promise<CalendarEvent> {
  const calendar = getCalendar();

  const event = await calendar.events.patch({
    calendarId,
    eventId,
    sendUpdates: "all", // Notifies users if their status changes (e.g., marked absent)
    requestBody: {
      attendees: attendees.map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
      })),
    },
  });

  return event.data as unknown as CalendarEvent;
}

export async function patchEvent(
  eventId: string,
  fields: {
    summary?: string;
    description?: string;
    attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  },
  calendarId: string = DEFAULT_CALENDAR_ID
): Promise<CalendarEvent> {
  const calendar = getCalendar();

  const event = await calendar.events.patch({
    calendarId,
    eventId,
    sendUpdates: "all",
    requestBody: fields,
  });

  return event.data as unknown as CalendarEvent;
}

export async function deleteEvent(
  eventId: string,
  calendarId: string = DEFAULT_CALENDAR_ID
): Promise<void> {
  const calendar = getCalendar();

  await calendar.events.delete({
    calendarId,
    eventId,
    sendUpdates: "all", // Sends a cancellation email to attendees
  });
}

export async function listEvents(
  calendarId: string = DEFAULT_CALENDAR_ID,
  options: {
    timeMin?: string;
    timeMax?: string;
    q?: string;
    singleEvents?: boolean;
    maxResults?: number;
    orderBy?: string;
  } = {}
): Promise<CalendarEvent[]> {
  const calendar = getCalendar();

  const singleEvents = options.singleEvents ?? true;

  const response = await calendar.events.list({
    calendarId,
    timeMin: options.timeMin || new Date().toISOString(),
    timeMax: options.timeMax,
    q: options.q,
    singleEvents,
    maxResults: options.maxResults || 100,
    // orderBy "startTime" is only valid when singleEvents is true
    ...(singleEvents ? { orderBy: options.orderBy || "startTime" } : {}),
  });

  return (response.data.items || []) as unknown as CalendarEvent[];
}

export async function fetchUserSchedule(
  userEmail: string,
  coachCalendarIds: string[]
): Promise<UserScheduleEvent[]> {
  const now = new Date().toISOString();
  const fourMonthsLater = new Date();
  fourMonthsLater.setMonth(fourMonthsLater.getMonth() + 4);

  // Filter out any undefined IDs to prevent API crashes
  const allCalendarIds = [DEFAULT_CALENDAR_ID, ...coachCalendarIds].filter(Boolean);
  const allEvents: UserScheduleEvent[] = [];

  const results = await Promise.allSettled(
    allCalendarIds.map((calId) =>
      listEvents(calId, {
        timeMin: now,
        timeMax: fourMonthsLater.toISOString(),
        q: userEmail,
        singleEvents: true,
      })
    )
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const calendarId = allCalendarIds[index];
      result.value.forEach((event) => {
        const attendee = event.attendees?.find(
          (a) => a.email === userEmail
        );
        if (attendee && event.start?.dateTime && event.end?.dateTime) {
          allEvents.push({
            id: event.id!,
            summary: event.summary || "Untitled Class",
            startTime: event.start.dateTime,
            endTime: event.end.dateTime,
            calendarId,
            attendeeStatus: attendee.responseStatus || "needsAction",
            isRecurring: !!event.recurrence,
          });
        }
      });
    }
  });

  allEvents.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  return allEvents;
}