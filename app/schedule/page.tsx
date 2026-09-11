import type { Metadata } from "next";
import Link from "next/link";
import { StageShell } from "@/components/shells/StageShell";
import { Badge } from "@/components/ui/Badge";
import { WhatsAppCta } from "@/components/marketing/WhatsAppCta";
import { fetchDiary, type DiaryEvent } from "@/lib/bluetick";
import {
  academyToday,
  formatIsoWallClock,
  formatWallDayLong,
  isoWallDate,
  shiftWallDate,
} from "@/lib/academy-time";

export const metadata: Metadata = {
  title: "Schedule",
  description:
    "This week's group table tennis classes across Bengaluru — times, venues and coaches. Book your place on WhatsApp.",
};

// The diary endpoint caches for five minutes; so does this page. A timetable
// that is five minutes stale is fine. A timetable that is a day stale is not.
export const revalidate = 300;

/** How many days one screen of the timetable shows. */
const WINDOW_DAYS = 7;

const WHATSAPP_MESSAGE =
  "Hi! I'd like to ask about a table tennis class on the schedule.";

/** A "YYYY-MM-DD" that is actually a date, or null. */
function parseFrom(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const round =
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d;
  return round ? raw : null;
}

/**
 * The public timetable is the group programme. A private lesson is somebody's
 * home address and a school session is somebody's campus — neither is a class a
 * stranger can turn up to, and neither belongs on a public page.
 */
function isPublicEvent(e: DiaryEvent): boolean {
  return e.attrs.school !== true && e.attrs.kind !== "private";
}

function venueOf(e: DiaryEvent): string {
  const venue = typeof e.attrs.venue === "string" ? e.attrs.venue.trim() : "";
  if (!venue) return "Venue to be confirmed";
  const unit =
    typeof e.attrs.venue_unit === "string" ? e.attrs.venue_unit.trim() : "";
  return unit ? `${venue} ${unit}` : venue;
}

function timeRange(e: DiaryEvent): string {
  const start = formatIsoWallClock(e.starts_at);
  const end = e.ends_at ? formatIsoWallClock(e.ends_at) : "";
  return end ? `${start} – ${end}` : start;
}

function EventRow({ event }: { event: DiaryEvent }) {
  const cancelled = event.status === "cancelled";
  const places =
    event.capacity !== null && event.capacity > 0
      ? `${event.taken} of ${event.capacity} places`
      : null;

  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0">
      <p
        className={`tnum w-40 shrink-0 text-sm ${
          cancelled ? "text-slate line-through" : "text-ivory"
        }`}
      >
        {timeRange(event)}
      </p>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            cancelled ? "text-slate line-through" : "text-ivory"
          }`}
        >
          {event.title}
        </p>
        <p className="mt-0.5 text-sm text-smoke">
          {event.host ? `Coach ${event.host.label}` : "Coach to be confirmed"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {places && <p className="tnum text-sm text-smoke">{places}</p>}
        {cancelled && <Badge tone="err">Cancelled</Badge>}
      </div>
    </li>
  );
}

function DaySection({
  date,
  events,
}: {
  date: string;
  events: DiaryEvent[];
}) {
  // Venues keep the order their first class of the day appears in, so an
  // evening venue never jumps above a morning one.
  const byVenue = new Map<string, DiaryEvent[]>();
  for (const event of events) {
    const venue = venueOf(event);
    const list = byVenue.get(venue) ?? [];
    list.push(event);
    byVenue.set(venue, list);
  }

  return (
    <section className="border-t border-line py-8">
      <h2 className="font-display text-2xl text-ivory md:text-3xl">
        {formatWallDayLong(date)}
      </h2>
      {byVenue.size === 0 ? (
        <p className="mt-3 text-smoke">No classes</p>
      ) : (
        <div className="mt-5 space-y-6">
          {[...byVenue.entries()].map(([venue, venueEvents]) => (
            <div
              key={venue}
              className="rounded-[12px] border border-line bg-ink-2 p-5"
            >
              <p className="label mb-3">{venue}</p>
              <ul>
                {venueEvents.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const requestedFrom = parseFrom(params.from);

  const result = await fetchDiary({
    from: requestedFrom ?? undefined,
    days: WINDOW_DAYS,
  });

  // The window the page draws. When bluetick answered, its `from` is the
  // authority — it resolved "today" on the academy's own clock, which a
  // visitor's browser and this server may both get wrong.
  const anchor = result.ok ? result.diary.from : requestedFrom ?? academyToday();
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) =>
    shiftWallDate(anchor, i)
  );

  const eventsByDay = new Map<string, DiaryEvent[]>(days.map((d) => [d, []]));
  if (result.ok) {
    for (const event of result.diary.events) {
      if (!isPublicEvent(event)) continue;
      const day = isoWallDate(event.starts_at);
      eventsByDay.get(day)?.push(event);
    }
  }

  const prev = shiftWallDate(anchor, -WINDOW_DAYS);
  const next = shiftWallDate(anchor, WINDOW_DAYS);

  return (
    <StageShell>
      <div className="mx-auto max-w-4xl px-6 pb-32 pt-28">
        <p className="label mb-3">Schedule</p>
        <h1 className="font-display mb-4 text-4xl md:text-6xl">This week</h1>
        <p className="mb-10 max-w-[52ch] text-lg text-smoke">
          Group classes across Bengaluru, in academy time. To book a place, ask
          a question or cancel, message us on WhatsApp — that&apos;s where
          everything happens now.
        </p>

        <nav
          aria-label="Week"
          className="flex items-center justify-between gap-4 border-y border-line py-4"
        >
          <Link
            href={`/schedule?from=${prev}`}
            className="inline-flex min-h-11 items-center text-sm text-fg-2 transition-colors hover:text-fg"
          >
            ← Previous week
          </Link>
          <p className="tnum text-sm text-smoke">
            {formatWallDayLong(days[0])} – {formatWallDayLong(days[days.length - 1])}
          </p>
          <Link
            href={`/schedule?from=${next}`}
            className="inline-flex min-h-11 items-center text-sm text-fg-2 transition-colors hover:text-fg"
          >
            Next week →
          </Link>
        </nav>

        {!result.ok && (
          <div className="mt-8 rounded-[12px] border border-ember bg-ink-2 p-6">
            <p className="font-display text-xl text-ivory">
              The timetable can&apos;t be loaded right now.
            </p>
            <p className="mt-2 max-w-[52ch] text-smoke">
              Message us on WhatsApp for this week&apos;s classes — we&apos;ll
              send you the times for your venue.
            </p>
            <WhatsAppCta
              className="mt-5"
              message="Hi! Could you send me this week's class times?"
            >
              Message us on WhatsApp
            </WhatsAppCta>
          </div>
        )}

        {result.ok && (
          <div className="mt-2">
            {days.map((day) => (
              <DaySection
                key={day}
                date={day}
                events={eventsByDay.get(day) ?? []}
              />
            ))}
          </div>
        )}

        <div className="mt-12 rounded-[12px] border border-line bg-ink-2 p-8 text-center md:p-12">
          <h2 className="font-display text-3xl md:text-4xl">
            Want a place in one of these?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-smoke">
            Booking, rescheduling and questions all happen in one WhatsApp
            thread. Tap below and tell us which class.
          </p>
          <div className="mt-6 flex justify-center">
            <WhatsAppCta size="lg" message={WHATSAPP_MESSAGE}>
              Book or ask on WhatsApp
            </WhatsAppCta>
          </div>
        </div>
      </div>

      {/* Sticky bottom CTA — phones only */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 p-3 backdrop-blur sm:hidden">
        <WhatsAppCta className="w-full" message={WHATSAPP_MESSAGE}>
          Book or ask on WhatsApp
        </WhatsAppCta>
      </div>
    </StageShell>
  );
}
