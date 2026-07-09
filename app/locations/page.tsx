import type { Metadata } from "next";
import { StageShell } from "@/components/shells/StageShell";
import { VenueMap } from "@/components/marketing/VenueMap";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import {
  getVenues,
  getGroupClasses,
  getUpcomingSessions,
  formatSessionTime,
} from "@/lib/data";

export const metadata: Metadata = {
  title: "Locations",
  description:
    "Sharwin TTA venues across Bengaluru with weekly group schedules.",
};

export default async function LocationsPage() {
  const [venues, classes, sessions] = await Promise.all([
    getVenues(),
    getGroupClasses(),
    getUpcomingSessions(7),
  ]);

  const classesByVenue = new Map<string, typeof classes>();
  for (const c of classes) {
    if (!c.venue_id) continue;
    const list = classesByVenue.get(c.venue_id) ?? [];
    list.push(c);
    classesByVenue.set(c.venue_id, list);
  }
  const nextSessionByClass = new Map<string, string>();
  for (const s of sessions) {
    if (!nextSessionByClass.has(s.class_id))
      nextSessionByClass.set(s.class_id, s.starts_at);
  }

  return (
    <StageShell>
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-28">
        <p className="label mb-3">Locations</p>
        <h1 className="font-display mb-4 text-4xl md:text-6xl">
          Pick your table
        </h1>
        <p className="mb-10 max-w-md text-lg text-smoke">
          Find a class near you, then create an account to book your spot —
          membership covers every session.
        </p>

        <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
          <div className="order-2 space-y-6 lg:order-1">
            {venues.map((venue) => (
              <div
                key={venue.id}
                className="rounded-[12px] border border-line bg-ink-2 p-5"
              >
                <h2 className="font-display text-xl">{venue.name}</h2>
                <p className="mt-1 text-sm text-smoke">
                  {venue.address} · {venue.postcode}
                </p>
                <ul className="mt-4 space-y-3">
                  {(classesByVenue.get(venue.id) ?? []).map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-3 border-t border-line pt-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{c.title}</p>
                        <p className="tnum text-sm text-smoke">
                          {nextSessionByClass.has(c.id)
                            ? `Next: ${formatSessionTime(nextSessionByClass.get(c.id)!)}`
                            : "Schedule coming soon"}
                        </p>
                      </div>
                      <Badge>{c.skill_level}</Badge>
                    </li>
                  ))}
                  {(classesByVenue.get(venue.id) ?? []).length === 0 && (
                    <li className="border-t border-line pt-3 text-sm text-smoke">
                      New classes announced soon.
                    </li>
                  )}
                </ul>
                {(classesByVenue.get(venue.id) ?? []).length > 0 && (
                  <ButtonLink
                    href="/signup?next=/app/book"
                    className="mt-5 w-full"
                  >
                    Book a class here
                  </ButtonLink>
                )}
              </div>
            ))}
            {venues.length === 0 && (
              <p className="text-smoke">Venues are being finalised — check back shortly.</p>
            )}
          </div>
          <div className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
            <VenueMap venues={venues} height="60vh" ctaHref="/signup?next=/app/book" ctaLabel="Book a class" autoLocate />
          </div>
        </div>

        {/* Closing CTA */}
        <div className="mt-16 rounded-[12px] border border-line bg-ink-2 p-8 text-center md:p-12">
          <h2 className="font-display text-3xl md:text-4xl">Ready to play?</h2>
          <p className="mx-auto mt-3 max-w-md text-smoke">
            Sign up, pick a membership, and book your first session at any of
            these venues in under two minutes.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup?next=/app/book" size="lg">
              Book a class
            </ButtonLink>
          </div>
        </div>
      </div>

      {/* Sticky bottom CTA — phones only */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 p-3 backdrop-blur sm:hidden">
        <ButtonLink href="/signup?next=/app/book" className="w-full">
          Book a class
        </ButtonLink>
      </div>
    </StageShell>
  );
}
