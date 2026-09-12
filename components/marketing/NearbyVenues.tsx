"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Venue } from "@/lib/data";
import { VenueMap } from "@/components/marketing/VenueMap";
import { Badge } from "@/components/ui/Badge";
import { venueDisplayName } from "@/lib/venue-display";
import { ButtonLink } from "@/components/ui/Button";

type VenueClassInfo = {
  id: string;
  title: string;
  skill_level: string;
  /** Pre-formatted "Next: …" line, or null if no upcoming session. */
  nextLabel: string | null;
};

export type EnrichedVenue = Venue & { classes: VenueClassInfo[] };

/** How many nearby venues a guest is shown. */
const MAX_VISIBLE = 3;
/** How many classes per venue a guest is shown before the teaser. */
const MAX_CLASSES_VISIBLE = 1;

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Renders only the {@link MAX_VISIBLE} venues nearest the visitor. We never
 * expose the full venue list to anonymous guests — until (and unless) we have
 * the visitor's location we fall back to the first few venues.
 */
export function NearbyVenues({ venues }: { venues: EnrichedVenue[] }) {
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(
    null
  );

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 10000 }
    );
  }, []);

  const visible = useMemo(() => {
    if (!origin) return venues.slice(0, MAX_VISIBLE);
    return [...venues]
      .sort((a, b) => haversineKm(origin, a) - haversineKm(origin, b))
      .slice(0, MAX_VISIBLE);
  }, [venues, origin]);

  return (
    <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
      <div className="order-2 space-y-6 lg:order-1">
        {visible.map((venue) => {
          const shownClasses = venue.classes.slice(0, MAX_CLASSES_VISIBLE);
          const hiddenClassCount = venue.classes.length - shownClasses.length;
          return (
            <div
              key={venue.id}
              className="rounded-[12px] border border-line bg-ink-2 p-5"
            >
              <h2 className="font-display text-xl">{venueDisplayName(venue)}</h2>
              <p className="mt-1 text-sm text-smoke">
                {venue.address} · {venue.postcode}
              </p>
              <ul className="mt-4 space-y-3">
                {shownClasses.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 border-t border-line pt-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{c.title}</p>
                      <p className="tnum text-sm text-smoke">
                        {c.nextLabel ?? "Schedule coming soon"}
                      </p>
                    </div>
                    <Badge>{c.skill_level}</Badge>
                  </li>
                ))}
                {venue.classes.length === 0 && (
                  <li className="border-t border-line pt-3 text-sm text-smoke">
                    New classes announced soon.
                  </li>
                )}
                {hiddenClassCount > 0 && (
                  <li className="border-t border-line pt-3">
                    <Link
                      href="/signup"
                      className="text-sm text-ember hover:underline"
                    >
                      +{hiddenClassCount} more{" "}
                      {hiddenClassCount === 1 ? "class" : "classes"} — create a
                      free account to see them
                    </Link>
                  </li>
                )}
              </ul>
              {venue.classes.length > 0 && (
                <ButtonLink href="/signup?next=/app/book" className="mt-5 w-full">
                  Book a class here
                </ButtonLink>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="text-smoke">
            Venues are being finalised — check back shortly.
          </p>
        )}

        {/* Teaser: more locations exist behind an account */}
        <div className="rounded-[12px] border border-dashed border-line bg-ink-2/60 p-5 text-center">
          <p className="text-sm font-medium text-ivory">
            We have more locations across Bengaluru
          </p>
          <p className="mt-1 text-sm text-smoke">
            Create a free account to see every venue and its full schedule.
          </p>
          <Link
            href="/signup"
            className="mt-4 inline-flex min-h-10 items-center rounded-[8px] border border-ember px-4 text-sm font-semibold text-ember transition hover:bg-ember hover:text-ivory"
          >
            See all locations →
          </Link>
        </div>
      </div>
      <div className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
        <VenueMap
          venues={visible}
          height="60vh"
          ctaHref="/signup?next=/app/book"
          ctaLabel="Book a class"
          autoLocate
        />
      </div>
    </div>
  );
}
