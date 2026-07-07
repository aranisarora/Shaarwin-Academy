"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Venue } from "@/lib/data";

/** Dark Mapbox map with ember venue pins. Tap pin → mini card → /locations. */
export function VenueMap({
  venues,
  height = "480px",
  interactiveCard = true,
}: {
  venues: Venue[];
  height?: string;
  interactiveCard?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const [selected, setSelected] = useState<Venue | null>(null);
  const [failed, setFailed] = useState(false);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            href="/locations"
            className="mt-3 inline-flex min-h-11 items-center rounded-[8px] bg-ember px-4 text-sm font-semibold text-ivory hover:bg-ember-2"
          >
            See classes
          </Link>
        </div>
      )}
    </div>
  );
}
