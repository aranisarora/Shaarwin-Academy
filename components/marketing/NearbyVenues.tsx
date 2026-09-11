"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Venue } from "@/lib/data";
import { VenueMap } from "@/components/marketing/VenueMap";
import { venueDisplayName } from "@/lib/venue-display";
import { ButtonLink } from "@/components/ui/Button";

/** How many nearby venues a visitor is shown before the rest are collapsed. */
const MAX_VISIBLE = 4;

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
 * The venues nearest the visitor first, with the map beside them.
 *
 * What each venue is running this week is no longer answered here: the
 * timetable is one page, /schedule, fed by bluetick, so a venue card says where
 * the place is and hands the visitor to the week rather than carrying a
 * half-copy of it.
 */
export function NearbyVenues({ venues }: { venues: Venue[] }) {
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 10000 }
    );
  }, []);

  const ordered = useMemo(() => {
    if (!origin) return venues;
    return [...venues].sort(
      (a, b) => haversineKm(origin, a) - haversineKm(origin, b)
    );
  }, [venues, origin]);

  const visible = showAll ? ordered : ordered.slice(0, MAX_VISIBLE);
  const hidden = ordered.length - visible.length;

  return (
    <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
      <div className="order-2 space-y-6 lg:order-1">
        {visible.map((venue) => (
          <div
            key={venue.id}
            className="rounded-[12px] border border-line bg-ink-2 p-5"
          >
            <h2 className="font-display text-xl">{venueDisplayName(venue)}</h2>
            <p className="mt-1 text-sm text-smoke">
              {venue.address} · {venue.postcode}
            </p>
            {venue.notes && (
              <p className="mt-2 text-sm text-slate">{venue.notes}</p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <ButtonLink href="/schedule">See the week here</ButtonLink>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-smoke underline decoration-line-d underline-offset-4 hover:text-ivory"
              >
                ↗ Open in maps
              </a>
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="text-smoke">
            Venues are being finalised — check back shortly.
          </p>
        )}
        {hidden > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full rounded-[12px] border border-dashed border-line bg-ink-2/60 p-5 text-center text-sm text-smoke transition hover:border-ember hover:text-ivory"
          >
            Show {hidden} more {hidden === 1 ? "venue" : "venues"} across
            Bengaluru
          </button>
        )}
        <p className="text-sm text-smoke">
          Don&apos;t see your area?{" "}
          <Link href="/schedule" className="text-ember hover:underline">
            Check the schedule
          </Link>{" "}
          — we also come to homes, offices, schools and colleges.
        </p>
      </div>
      <div className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
        <VenueMap
          venues={visible}
          height="60vh"
          ctaHref="/schedule"
          ctaLabel="See the week"
          autoLocate
        />
      </div>
    </div>
  );
}
