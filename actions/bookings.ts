"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createEvent,
  listEvents,
  getEvent,
  patchEvent,
} from "@/lib/google/calendar";
import {
  generateRRule,
  getNextOccurrence,
  toISTDateTimeString,
  buildEventDescription,
  addAttendeeToDescription,
} from "@/lib/utils";
import { TIMEZONE } from "@/config/operating-hours";
import { BOOKING_DURATION_MONTHS, DAY_TO_RRULE } from "@/lib/constants";
import type { Batch } from "@/types/database";

/**
 * Count active bookings per batch. Uses admin client to bypass RLS
 * so unauthenticated users can see how full each batch is.
 */
export async function getBatchBookingCounts(
  batchIds: number[]
): Promise<Record<number, number>> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("bookings")
    .select("batch_id")
    .in("batch_id", batchIds)
    .eq("status", "active");

  if (error) {
    console.error("getBatchBookingCounts: failed", error);
    throw new Error("Failed to load booking counts");
  }

  const counts: Record<number, number> = {};
  for (const row of data || []) {
    counts[row.batch_id] = (counts[row.batch_id] || 0) + 1;
  }
  return counts;
}

/**
 * Return the set of batch IDs the current user has already booked (active).
 * Returns an empty set when the user is not authenticated.
 */
export async function getUserBookedBatchIds(
  batchIds: number[]
): Promise<number[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("bookings")
    .select("batch_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .in("batch_id", batchIds);

  if (error) {
    console.error("getUserBookedBatchIds: failed", error);
    return [];
  }

  return (data || []).map((row) => row.batch_id);
}

export async function createGroupBooking(data: {
  batchIds: number[];
  userName: string;
  phoneNumber: string;
}) {
  const supabase = await createClient();
  const admin = createAdminClient();

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.error("createGroupBooking: called without authenticated user");
    throw new Error("Not authenticated");
  }

  // Update profile (non-blocking)
  try {
    await supabase
      .from("profiles")
      .update({
        full_name: data.userName,
        phone_number: data.phoneNumber,
      })
      .eq("id", user.id);
  } catch (e) {
    console.warn(
      "createGroupBooking: profile update failed (non-blocking)",
      e
    );
  }

  const results: { batchId: number; eventId: string }[] = [];

  for (const batchId of data.batchIds) {
    // Fetch batch with location
    const { data: batch, error: batchError } = await supabase
      .from("batches")
      .select("*, location:locations(*)")
      .eq("id", batchId)
      .single();

    if (batchError || !batch) {
      console.error("createGroupBooking: failed to load batch", {
        batchId,
        error: batchError,
      });
      throw new Error(
        batchError?.message
          ? `Failed to load batch ${batchId}: ${batchError.message}`
          : `Batch ${batchId} not found`
      );
    }
    const typedBatch = batch as Batch;

    // Check if user already has an active booking for this batch
    const { count: existingCount } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("batch_id", batchId)
      .eq("status", "active");

    if (existingCount && existingCount > 0) {
      throw new Error(`You have already booked batch "${typedBatch.title}"`);
    }

    // Check capacity: count active bookings for this batch
    const { count, error: countError } = await admin
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .eq("status", "active");

    if (countError) {
      console.error("createGroupBooking: failed to check capacity", {
        batchId,
        error: countError,
      });
      throw new Error(
        `Failed to verify capacity for batch ${batchId}: ${
          countError.message ?? "Unknown error"
        }`
      );
    }

    const currentCount = count || 0;
    if (currentCount >= typedBatch.max_capacity) {
      throw new Error(`Batch "${typedBatch.title}" is full`);
    }

    // Build event title: "[Class type] Class at [location name]"
    const locationName = typedBatch.location?.name || "Location";
    const locationAddress = typedBatch.location?.address || "";
    const classType = typedBatch.class_type || "group";
    const classTypeLabel =
      classType.charAt(0).toUpperCase() + classType.slice(1);
    const summary = `${classTypeLabel} Class at ${locationName}`;

    // Get all coach calendar IDs for searching existing events
    const { data: coaches } = await supabase
      .from("coaches")
      .select("gcal_id");
    const coachCalendarIds = (coaches || []).map((c) => c.gcal_id).filter(Boolean);
    const allCalendarIds = [
      process.env.GOOGLE_CALENDAR_ID!,
      ...coachCalendarIds,
    ].filter(Boolean);

    // Create one recurring event per day code
    const eventIds: string[] = [];
    for (const dayCode of typedBatch.day_codes) {
      // Calculate dates for this specific day
      const startDate = getNextOccurrence([dayCode]);
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + BOOKING_DURATION_MONTHS);

      const rrule = generateRRule([dayCode], endDate);
      const startDateTime = toISTDateTimeString(
        startDate,
        typedBatch.start_time
      );
      const endDateTime = toISTDateTimeString(startDate, typedBatch.end_time);

      // Try to find an existing event for this batch/day across all calendars
      let existingEvent = null;
      let existingCalendarId: string | null = null;

      for (const calId of allCalendarIds) {
        try {
          const events = await listEvents(calId, {
            timeMin: new Date().toISOString(),
            q: summary,
            singleEvents: false,
            maxResults: 50,
          });
          // Match on title, day, and time
          const match = events.find((e) => {
            if (e.summary !== summary) return false;
            // Check the recurrence includes this day
            const recStr = e.recurrence?.join("") || "";
            return recStr.includes(`BYDAY=${dayCode}`);
          });
          if (match) {
            existingEvent = await getEvent(match.id, calId);
            existingCalendarId = calId;
            break;
          }
        } catch {
          // Calendar not accessible, skip
        }
      }

      if (existingEvent && existingCalendarId) {
        // Add user as attendee to existing event
        const currentAttendees = existingEvent.attendees || [];
        const alreadyAdded = currentAttendees.some(
          (a) => a.email === user.email
        );
        if (!alreadyAdded) {
          const newAttendees = [
            ...currentAttendees.map((a) => ({
              email: a.email,
              displayName: a.displayName,
              responseStatus: a.responseStatus,
            })),
            { email: user.email!, displayName: data.userName },
          ];
          const updatedDescription = addAttendeeToDescription(
            existingEvent.description,
            data.userName,
            data.phoneNumber
          );
          await patchEvent(
            existingEvent.id,
            { attendees: newAttendees, description: updatedDescription },
            existingCalendarId
          );
        }
        eventIds.push(existingEvent.id);
      } else {
        // Create new per-day recurring event
        const gcalEvent = await createEvent({
          summary,
          description: buildEventDescription(data.userName, data.phoneNumber),
          location: locationAddress || locationName,
          startDateTime,
          endDateTime,
          timeZone: TIMEZONE,
          recurrence: [rrule],
          attendees: [{ email: user.email!, displayName: data.userName }],
        });
        eventIds.push(gcalEvent.id);
      }
    }

    // Calculate booking date range (earliest start across all days)
    const bookingStartDate = getNextOccurrence(typedBatch.day_codes);
    const bookingEndDate = new Date(bookingStartDate);
    bookingEndDate.setMonth(
      bookingEndDate.getMonth() + BOOKING_DURATION_MONTHS
    );

    // Insert booking record
    const { error: bookingError } = await supabase.from("bookings").insert({
      user_id: user.id,
      batch_id: batchId,
      status: "active",
      start_date: bookingStartDate.toISOString().split("T")[0],
      end_date: bookingEndDate.toISOString().split("T")[0],
    });

    if (bookingError) {
      console.error("createGroupBooking: failed to create booking record", {
        batchId,
        error: bookingError,
      });
      throw new Error(
        `Failed to create booking record: ${
          bookingError.message ?? "Unknown error"
        }`
      );
    }

    results.push({ batchId, eventId: eventIds[0] });
  }

  return { success: true, results };
}

export async function createPrivateBooking(data: {
  locationName: string;
  locationAddress: string;
  slots: Array<{ day: string; startTime: string }>;
  frequency: "one-time" | "weekly";
  userName: string;
  phoneNumber: string;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.error("createPrivateBooking: called without authenticated user");
    throw new Error("Not authenticated");
  }

  // Update profile (non-blocking)
  try {
    await supabase
      .from("profiles")
      .update({
        full_name: data.userName,
        phone_number: data.phoneNumber,
      })
      .eq("id", user.id);
  } catch (e) {
    console.warn(
      "createPrivateBooking: profile update failed (non-blocking)",
      e
    );
  }

  // Always create a new private location
  const { data: newLocation, error: locError } = await supabase
    .from("locations")
    .insert({
      name: data.locationName,
      address: data.locationAddress || "",
      type: "private",
      is_active: true,
    })
    .select()
    .single();

  if (locError || !newLocation) {
    console.error("createPrivateBooking: failed to create private location", {
      payload: { name: data.locationName, address: data.locationAddress },
      error: locError,
    });
    throw new Error(
      `Failed to create private location: ${
        locError?.message ?? "Unknown error"
      }`
    );
  }

  // Group slots by startTime so slots with the same time share a batch
  const grouped = new Map<string, string[]>();
  for (const slot of data.slots) {
    const existing = grouped.get(slot.startTime) || [];
    existing.push(slot.day);
    grouped.set(slot.startTime, existing);
  }

  const results: { batchId: number; eventId: string }[] = [];

  for (const [startTime, dayNames] of grouped) {
    const endTime = addOneHourServer(startTime);

    // Convert full day names to RRULE day codes for the day_codes column
    const dayCodes = dayNames.map((d) => DAY_TO_RRULE[d] || d);

    // Create batch
    const { data: newBatch, error: batchError } = await supabase
      .from("batches")
      .insert({
        location_id: newLocation.id,
        title: `Private - ${data.userName}`,
        day_codes: dayCodes,
        start_time: startTime,
        end_time: endTime,
        max_capacity: 1,
        class_type: "private",
        is_active: true,
      })
      .select()
      .single();

    if (batchError || !newBatch) {
      console.error("createPrivateBooking: failed to create batch", {
        locationId: newLocation.id,
        error: batchError,
      });
      throw new Error(
        `Failed to create batch: ${batchError?.message ?? "Unknown error"}`
      );
    }

    // Calculate dates
    const startDate = getNextOccurrence(dayCodes);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + BOOKING_DURATION_MONTHS);

    const startDateTime = toISTDateTimeString(startDate, startTime);
    const endDateTime = toISTDateTimeString(startDate, endTime);

    // Build recurrence (only for weekly)
    const recurrence =
      data.frequency === "weekly"
        ? [generateRRule(dayCodes, endDate)]
        : undefined;

    // GCal event title: "Private Class at [location name]"
    const summary = `Private Class at ${data.locationName}`;

    const gcalEvent = await createEvent({
      summary,
      description: buildEventDescription(data.userName, data.phoneNumber),
      location: data.locationAddress || data.locationName,
      startDateTime,
      endDateTime,
      timeZone: TIMEZONE,
      recurrence,
      attendees: [{ email: user.email!, displayName: data.userName }],
    });

    // Insert booking record (only columns that exist in the schema)
    const { error: bookingError } = await supabase.from("bookings").insert({
      user_id: user.id,
      batch_id: newBatch.id,
      status: "active",
      start_date: startDate.toISOString().split("T")[0],
      end_date: endDate.toISOString().split("T")[0],
    });

    if (bookingError) {
      console.error("createPrivateBooking: failed to create booking record", {
        batchId: newBatch.id,
        error: bookingError,
      });
      throw new Error(
        `Failed to create booking record: ${
          bookingError.message ?? "Unknown error"
        }`
      );
    }

    results.push({ batchId: newBatch.id, eventId: gcalEvent.id });
  }

  return { success: true, results };
}

function addOneHourServer(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
