import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listEvents } from "@/lib/google/calendar";
import { sendText } from "@/lib/whatsapp";
import type { CalendarEvent } from "@/types/calendar";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

function getTodayISTRange(): { timeMin: string; timeMax: string; dateLabel: string } {
  const now = new Date();
  // Shift clock to IST to read the IST calendar date
  const nowIST = new Date(now.getTime() + IST_OFFSET_MS);
  const y = nowIST.getUTCFullYear();
  const m = nowIST.getUTCMonth();
  const d = nowIST.getUTCDate();

  // Midnight IST as UTC timestamp
  const midnightIST_UTC = new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
  const timeMin = midnightIST_UTC.toISOString();
  const timeMax = new Date(midnightIST_UTC.getTime() + 24 * 60 * 60 * 1000).toISOString();

  // Human-readable date label in IST
  const dateLabel = new Date(Date.UTC(y, m, d)).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return { timeMin, timeMax, dateLabel };
}

function formatEventTime(dateTimeStr: string): string {
  return new Date(dateTimeStr).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    hour12: true,
  });
}

function formatEventLine(event: CalendarEvent): string {
  const start = event.start?.dateTime ? formatEventTime(event.start.dateTime) : "?";
  const end = event.end?.dateTime ? formatEventTime(event.end.dateTime) : "?";
  const active = (event.attendees || []).filter(
    (a) => a.responseStatus !== "declined"
  );
  const names = active.map((a) => a.displayName || a.email).join(", ");
  const title = event.summary || "Untitled";
  return `• ${title} (${start}–${end})${names ? `\n  Students: ${names}` : ""}`;
}

function buildCoachMessage(coachName: string, events: CalendarEvent[], dateLabel: string): string {
  if (events.length === 0) {
    return `Good morning, ${coachName}! 🏓\n\nYou have no classes scheduled for today (${dateLabel}). Enjoy your day!`;
  }
  const lines = [
    `Good morning, ${coachName}! 🏓`,
    `Here are your classes for today (${dateLabel}):`,
    "",
    ...events.map(formatEventLine),
    "",
    `Total: ${events.length} class(es)`,
  ];
  return lines.join("\n");
}

function buildFounderMessage(
  coaches: Array<{ name: string; events: CalendarEvent[] }>,
  mainEvents: CalendarEvent[],
  dateLabel: string
): string {
  const lines = [`Good morning! 🏓 Class overview for today (${dateLabel}):`, ""];

  if (mainEvents.length > 0) {
    lines.push("📅 Main Calendar:");
    mainEvents.forEach((e) => lines.push(formatEventLine(e)));
    lines.push("");
  }

  for (const { name, events } of coaches) {
    if (events.length > 0) {
      lines.push(`👤 ${name}:`);
      events.forEach((e) => lines.push(formatEventLine(e)));
      lines.push("");
    }
  }

  const coachTotal = coaches.reduce((s, c) => s + c.events.length, 0);
  const total = mainEvents.length + coachTotal;

  if (total === 0) {
    lines.push("No classes scheduled today.");
  } else {
    lines.push(`Total: ${total} class(es) across all coaches.`);
  }

  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends Authorization: Bearer <CRON_SECRET>)
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { timeMin, timeMax, dateLabel } = getTodayISTRange();
    const admin = createAdminClient();

    // Fetch active coaches with their profile (name + phone)
    const { data: coachRows } = await admin
      .from("coaches")
      .select("id, gcal_id, profile:profiles(full_name, phone_number)")
      .eq("is_active", true);

    const coaches = (coachRows || []).map((row) => {
      const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
      return {
        id: row.id as number,
        gcalId: row.gcal_id as string,
        name: (profile?.full_name as string) || "Coach",
        phone: (profile?.phone_number as string) || "",
      };
    });

    // Fetch main calendar events
    const mainCalId = process.env.GOOGLE_CALENDAR_ID!;
    let mainEvents: CalendarEvent[] = [];
    try {
      mainEvents = await listEvents(mainCalId, { timeMin, timeMax, singleEvents: true });
    } catch (e) {
      console.warn("Failed to fetch main calendar events:", e);
    }

    // Fetch each coach's calendar events
    const coachSummaries: Array<{ name: string; events: CalendarEvent[] }> = [];
    const FOUNDER_PHONE = process.env.FOUNDER_PHONE!;
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    for (const coach of coaches) {
      let events: CalendarEvent[] = [];
      if (coach.gcalId) {
        try {
          events = await listEvents(coach.gcalId, { timeMin, timeMax, singleEvents: true });
        } catch (e) {
          console.warn(`Failed to fetch events for coach ${coach.name}:`, e);
        }
      }

      coachSummaries.push({ name: coach.name, events });

      // Send each coach their own summary
      if (coach.phone) {
        const msg = buildCoachMessage(coach.name, events, dateLabel);
        await sendText(coach.phone, `${msg}\n\nView your schedule:\n${APP_URL}/dashboard/bookings`);
      }
    }

    // Send founder the full overview
    if (FOUNDER_PHONE) {
      const founderMsg = buildFounderMessage(coachSummaries, mainEvents, dateLabel);
      await sendText(FOUNDER_PHONE, founderMsg);
    }

    return NextResponse.json({ success: true, dateLabel });
  } catch (e) {
    console.error("Morning summary error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
