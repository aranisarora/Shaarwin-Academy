import type { Metadata } from "next";
import { Suspense } from "react";
import { StageShell } from "@/components/shells/StageShell";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  NearbyVenues,
  type EnrichedVenue,
} from "@/components/marketing/NearbyVenues";
import {
  getVenues,
  getGroupClasses,
  getUpcomingSessions,
  formatSessionTime,
} from "@/lib/data";

export const metadata: Metadata = {
  title: "Locations",
  description:
    "Sharwin Table Tennis Academy venues across Bengaluru with weekly group schedules.",
};

// ISR: static shell served from the edge, regenerated every 10 min to keep the
// "next session" times fresh. Underlying reads (getVenues/getGroupClasses/
// getUpcomingSessions) are cache-tagged, so admin edits also refresh it.
export const revalidate = 600;

// Waits on Supabase inside a <Suspense> boundary so the page header and CTAs
// paint immediately while the venue list + map stream in.
async function VenuesSection() {
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

  // Enrich each venue with its class info so the client component can filter to
  // the visitor's nearest venues without re-fetching. We deliberately hand the
  // full list to a client component that only ever renders the nearest few —
  // guests never see every venue.
  const enriched: EnrichedVenue[] = venues.map((venue) => ({
    ...venue,
    classes: (classesByVenue.get(venue.id) ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      skill_level: c.skill_level,
      nextLabel: nextSessionByClass.has(c.id)
        ? `Next: ${formatSessionTime(nextSessionByClass.get(c.id)!)}`
        : null,
    })),
  }));

  return <NearbyVenues venues={enriched} />;
}

function VenuesSectionSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
      <div className="order-2 space-y-6 lg:order-1">
        <Skeleton className="h-56 w-full rounded-[12px]" />
        <Skeleton className="h-56 w-full rounded-[12px]" />
      </div>
      <div className="order-1 lg:order-2">
        <Skeleton className="h-[60vh] w-full rounded-[12px]" />
      </div>
    </div>
  );
}

export default function LocationsPage() {
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

        <Suspense fallback={<VenuesSectionSkeleton />}>
          <VenuesSection />
        </Suspense>

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
