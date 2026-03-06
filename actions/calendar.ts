"use server";

import { createClient } from "@/lib/supabase/server";
import {
  fetchUserSchedule,
  getEvent,
  patchEvent,
  createEvent,
} from "@/lib/google/calendar";
import {
  markAttendeeAbsent,
  removeAttendeeFromDescription,
  addAttendeeToDescription,
} from "@/lib/utils";
import { TIMEZONE } from "@/config/operating-hours";
import type { UserScheduleEvent } from "@/types/calendar";
import { notifyAbsenceConfirmed, notifyRescheduleConfirmed } from "@/lib/whatsapp";

export async function getUserSchedule(): Promise<UserScheduleEvent[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Not authenticated");

  // Get all coach calendar IDs
  const { data: coaches } = await supabase
    .from("coaches")
    .select("gcal_id");

  const coachCalendarIds = (coaches || []).map((c) => c.gcal_id);

  return fetchUserSchedule(user.email, coachCalendarIds);
}

export async function markAbsent(data: {
  eventId: string;
  calendarId: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Not authenticated");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone_number")
    .eq("id", user.id)
    .single();

  // Get the event
  const event = await getEvent(data.eventId, data.calendarId);

  if (!event.attendees) throw new Error("No attendees on this event");

  // Update the user's attendee status to declined
  const updatedAttendees = event.attendees.map((a) => ({
    email: a.email,
    displayName: a.displayName,
    responseStatus:
      a.email === user.email ? "declined" : (a.responseStatus || "needsAction"),
  }));

  // Update description to mark user as absent
  const updatedDescription = markAttendeeAbsent(
    event.description,
    user.email,
    event.attendees
  );

  // Check if all attendees are now declined (effectively 0 active)
  const activeAttendees = updatedAttendees.filter(
    (a) => a.responseStatus !== "declined"
  );

  if (activeAttendees.length === 0) {
    // No active attendees: add CANCELLED to title
    const cancelledSummary = event.summary?.startsWith("CANCELLED")
      ? event.summary
      : `CANCELLED - ${event.summary}`;
    await patchEvent(
      data.eventId,
      {
        summary: cancelledSummary,
        description: updatedDescription,
        attendees: updatedAttendees,
      },
      data.calendarId
    );
  } else {
    await patchEvent(
      data.eventId,
      { description: updatedDescription, attendees: updatedAttendees },
      data.calendarId
    );
  }

  // TODO: WhatsApp notifications — Coming Soon
  // try {
  //   if (profile?.phone_number) {
  //     const dateStr = event.start?.dateTime
  //       ? new Date(event.start.dateTime).toLocaleString("en-IN", {
  //           weekday: "long",
  //           day: "numeric",
  //           month: "long",
  //           hour: "2-digit",
  //           minute: "2-digit",
  //           timeZone: "Asia/Kolkata",
  //           hour12: true,
  //         })
  //       : "";
  //     await notifyAbsenceConfirmed(
  //       profile.phone_number,
  //       profile.full_name || "Student",
  //       event.summary || "Class",
  //       dateStr
  //     );
  //   }
  // } catch (e) {
  //   console.warn("markAbsent: WA notification failed (non-blocking)", e);
  // }

  return { success: true };
}

export async function reschedule(data: {
  oldEventId: string;
  oldCalendarId: string;
  newSlotDateTime: string;
  newEndDateTime: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Not authenticated");

  const userName = user.user_metadata.full_name || "";
  const { data: profile } = await supabase
    .from("profiles")
    .select("phone_number")
    .eq("id", user.id)
    .single();
  const phoneNumber = profile?.phone_number || "";

  // Get old event
  const oldEvent = await getEvent(data.oldEventId, data.oldCalendarId);

  // Remove user from old event
  if (oldEvent.attendees) {
    const remainingAttendees = oldEvent.attendees.filter(
      (a) => a.email !== user.email
    );

    // Update description to remove user
    const updatedDescription = removeAttendeeFromDescription(
      oldEvent.description,
      user.email,
      oldEvent.attendees
    );

    if (remainingAttendees.length === 0) {
      // No attendees left: mark user as declined, add CANCELLED to title
      const cancelledSummary = oldEvent.summary?.startsWith("CANCELLED")
        ? oldEvent.summary
        : `CANCELLED - ${oldEvent.summary}`;
      const declinedAttendees = oldEvent.attendees.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        responseStatus:
          a.email === user.email ? "declined" : (a.responseStatus || "needsAction"),
      }));
      await patchEvent(
        data.oldEventId,
        {
          summary: cancelledSummary,
          description: updatedDescription,
          attendees: declinedAttendees,
        },
        data.oldCalendarId
      );
    } else {
      // Update attendees without the user
      await patchEvent(
        data.oldEventId,
        {
          description: updatedDescription,
          attendees: remainingAttendees.map((a) => ({
            email: a.email,
            displayName: a.displayName,
            responseStatus: a.responseStatus,
          })),
        },
        data.oldCalendarId
      );
    }
  }

  // Build description for the new event with user info
  const newDescription = addAttendeeToDescription(
    undefined,
    userName,
    phoneNumber
  );

  // Create new event with the user
  const newEvent = await createEvent({
    summary: oldEvent.summary?.replace(/^CANCELLED - /, "") || oldEvent.summary,
    description: newDescription,
    startDateTime: data.newSlotDateTime,
    endDateTime: data.newEndDateTime,
    timeZone: TIMEZONE,
    attendees: [{ email: user.email, displayName: userName }],
    calendarId: data.oldCalendarId,
  });

  // TODO: WhatsApp notifications — Coming Soon
  // try {
  //   if (phoneNumber) {
  //     const newDateStr = new Date(data.newSlotDateTime).toLocaleString("en-IN", {
  //       weekday: "long",
  //       day: "numeric",
  //       month: "long",
  //       hour: "2-digit",
  //       minute: "2-digit",
  //       timeZone: "Asia/Kolkata",
  //       hour12: true,
  //     });
  //     await notifyRescheduleConfirmed(
  //       phoneNumber,
  //       userName || "Student",
  //       newEvent.summary || "Class",
  //       newDateStr
  //     );
  //   }
  // } catch (e) {
  //   console.warn("reschedule: WA notification failed (non-blocking)", e);
  // }

  return { success: true, newEventId: newEvent.id };
}
