import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Valid .ics for a booking — owner only (enforced by query filter + RLS). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id,client_id,class_sessions!inner(starts_at,ends_at,classes!inner(title,venues(name,address,postcode)))"
    )
    .eq("id", bookingId)
    .eq("client_id", user.id)
    .maybeSingle();

  if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const session = booking.class_sessions;

  const toIcs = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const venue = session.classes.venues;
  const location = venue ? `${venue.name}, ${venue.address}, ${venue.postcode}` : "Your address";

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sharwin TTA//Booking//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:booking-${booking.id}@sharwintta`,
    `DTSTAMP:${toIcs(new Date().toISOString())}`,
    `DTSTART:${toIcs(session.starts_at)}`,
    `DTEND:${toIcs(session.ends_at)}`,
    `SUMMARY:${session.classes.title} — Sharwin TTA`,
    `LOCATION:${location.replace(/,/g, "\\,")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="sharwin-session.ics"`,
    },
  });
}
