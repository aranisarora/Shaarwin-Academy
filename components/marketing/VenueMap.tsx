"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Venue } from "@/lib/data";

/** Dark Mapbox map with ember venue pins. Tap pin → mini card. Locate-me button shows user position. */
export function VenueMap({
  venues,
  height = "480px",
  interactiveCard = true,
  ctaHref = "/locations",
  ctaLabel = "See classes",
}: {
  venues: Venue[];
  height?: string;
  interactiveCard?: boolean;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapboxglRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMarkerRef = useRef<any>(null);

  const [selected, setSelected] = useState<Venue | null>(null);
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token || !containerRef.current || venues.length === 0) {
      setFailed(!token || venues.length === 0);
      return;
    }

    (async () => {
      try {
        const mapboxgl = (await import("mapbox-gl")).default;
        await import("mapbox-gl/dist/mapbox-gl.css");
        if (cancelled || !containerRef.current) return;

        mapboxglRef.current = mapboxgl;
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [77.62, 12.94],
          zoom: 10.4,
          attributionControl: false,
          cooperativeGestures: true,
        });
        mapRef.current = map;

        const bounds = new mapboxgl.LngLatBounds();
        for (const venue of venues) {
          const el = document.createElement("button");
          el.setAttribute("aria-label", venue.name);
          el.style.cssText =
            "width:16px;height:16px;border-radius:999px;background:#E8590C;border:2px solid #F4F1EA;cursor:pointer;box-shadow:0 0 0 4px rgb(232 89 12 / 0.25)";
          el.addEventListener("click", () => setSelected(venue));
          new mapboxgl.Marker({ element: el })
            .setLngLat([venue.lng, venue.lat])
            .addTo(map);
          bounds.extend([venue.lng, venue.lat]);
        }
        if (venues.length > 1) map.fitBounds(bounds, { padding: 72, maxZoom: 12 });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      mapboxglRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locateMe() {
    if (!navigator.geolocation) return;
    setLocating(true);
    setLocationDenied(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lng } = pos.coords;
        const map = mapRef.current;
        const mapboxgl = mapboxglRef.current;
        if (!map || !mapboxgl) return;

        // Remove previous user marker
        userMarkerRef.current?.remove();

        const el = document.createElement("div");
        el.setAttribute("aria-label", "Your location");
        el.style.cssText =
          "width:14px;height:14px;border-radius:999px;background:#3B82F6;border:2px solid #fff;box-shadow:0 0 0 4px rgb(59 130 246 / 0.3)";
        userMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);

        map.flyTo({ center: [lng, lat], zoom: 12, duration: 1200 });
      },
      () => {
        setLocating(false);
        setLocationDenied(true);
      },
      { timeout: 10000 }
    );
  }

  if (failed) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-[12px] border border-line bg-surface-2"
      >
        <div className="text-center">
          <p className="mb-2 text-fg-2">Our venues</p>
          <ul className="space-y-1 text-sm">
            {venues.map((v) => (
              <li key={v.id}>
                {v.name} · {v.postcode}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[12px] border border-line" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />

      {/* Locate-me button */}
      <button
        onClick={locateMe}
        disabled={locating}
        title="Show my location"
        aria-label="Show my location on the map"
        className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-[8px] border border-line-d bg-ink-2 text-ivory shadow transition hover:bg-ink disabled:opacity-60"
      >
        {locating ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        )}
      </button>

      {/* Permission denied notice */}
      {locationDenied && (
        <div className="absolute right-3 top-14 z-10 max-w-[200px] rounded-[8px] border border-line-d bg-ink-2 px-3 py-2 text-xs text-smoke shadow">
          Location access denied. Enable it in your browser settings.
        </div>
      )}

      {selected && interactiveCard && (
        <div className="absolute inset-x-4 bottom-4 rounded-[12px] border border-line-d bg-ink-2 p-4 sm:left-auto sm:w-80">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-lg text-ivory">{selected.name}</p>
              <p className="text-sm text-smoke">
                {selected.address} · {selected.postcode}
              </p>
            </div>
            <button
              aria-label="Close"
              onClick={() => setSelected(null)}
              className="text-smoke hover:text-ivory"
            >
              ✕
            </button>
          </div>
          <Link
            href={ctaHref}
            className="mt-3 inline-flex min-h-11 items-center rounded-[8px] bg-ember px-4 text-sm font-semibold text-ivory hover:bg-ember-2"
          >
            {ctaLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
