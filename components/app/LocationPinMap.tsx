"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * A dark Mapbox map with a single draggable ember pin — the location refiner
 * shared by every address-entry surface (venues, coach base, private booking).
 * Lazy-imports `mapbox-gl` so it only loads when a pin is actually shown.
 *
 * `lat`/`lng` seed the initial centre and marker; dragging the pin calls
 * `onMove` with the new position. The map is created once per mount — the
 * parent controls remounting (e.g. via `key`) if it needs to recentre on a
 * fresh geocode, matching how the marker also follows `lat`/`lng` changes.
 */
export function LocationPinMap({
  lat,
  lng,
  zoom = 15,
  onMove,
  className = "h-56 overflow-hidden rounded-[12px] border border-line",
}: {
  lat: number;
  lng: number;
  zoom?: number;
  onMove: (lat: number, lng: number) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  // Keep the latest onMove without re-creating the map when the parent
  // re-renders with a new closure. Written in a layout effect (not during
  // render) so it's ready before the map's dragend handler can fire.
  const onMoveRef = useRef(onMove);
  useLayoutEffect(() => {
    onMoveRef.current = onMove;
  });

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    (async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
      if (!token) return;
      const mapboxgl = (await import("mapbox-gl")).default;
      await import("mapbox-gl/dist/mapbox-gl.css");
      if (cancelled || !container.current) return;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: container.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [lng, lat],
        zoom,
        attributionControl: false,
      });
      mapRef.current = map;
      const el = document.createElement("div");
      el.style.cssText =
        "width:20px;height:20px;border-radius:999px;background:#E8590C;border:3px solid #F4F1EA;cursor:grab;box-shadow:0 0 0 6px rgb(232 89 12 / 0.25)";
      const marker = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        onMoveRef.current(pos.lat, pos.lng);
      });
      markerRef.current = marker;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Create once per mount; the marker-follow effect below handles moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow external position changes (a fresh geocode) without a full rebuild.
  useEffect(() => {
    markerRef.current?.setLngLat([lng, lat]);
    mapRef.current?.easeTo({ center: [lng, lat], zoom });
  }, [lat, lng, zoom]);

  return <div ref={container} className={className} />;
}
