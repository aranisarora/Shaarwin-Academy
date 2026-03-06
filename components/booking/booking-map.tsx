"use client";

import { useEffect, useRef, useState } from "react";
import type { Location } from "@/types/database";
import "leaflet/dist/leaflet.css";

interface BookingMapProps {
  locations: Location[];
  onMapReady: (focusMarker: (locationId: number) => void) => void;
}

const BENGALURU: [number, number] = [12.9716, 77.5946];

async function geocode(name: string): Promise<[number, number] | null> {
  try {
    const q = encodeURIComponent(`${name}, Bengaluru, India`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    if (data[0]) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } catch {}
  return null;
}

export function BookingMap({ locations, onMapReady }: BookingMapProps) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<Map<number, import("leaflet").Marker>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const L = (await import("leaflet")).default;

        if (cancelled || !mapDivRef.current) return;

        const pinIcon = L.divIcon({
          html: `<div style="width:24px;height:24px;background:#ef4444;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>`,
          className: "",
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

        const map = L.map(mapDivRef.current).setView(BENGALURU, 12);
        mapRef.current = map;

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(map);

        await Promise.all(
          locations.map(async (loc) => {
            const coords = await geocode(loc.name);
            if (cancelled || !coords) return;
            const marker = L.marker(coords, { icon: pinIcon, title: loc.name })
              .addTo(map)
              .bindPopup(loc.name);
            markersRef.current.set(loc.id, marker);
          })
        );

        if (cancelled) return;

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (cancelled) return;
              const userIcon = L.divIcon({
                html: `<div style="width:20px;height:20px;background:#4285F4;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>`,
                className: "",
                iconSize: [20, 20],
                iconAnchor: [10, 10],
              });
              L.marker([pos.coords.latitude, pos.coords.longitude], {
                icon: userIcon,
                title: "Your location",
              }).addTo(map);
            },
            () => {},
            { timeout: 5000 }
          );
        }

        onMapReady((locationId) => {
          const marker = markersRef.current.get(locationId);
          if (marker) map.setView(marker.getLatLng(), 15, { animate: true });
        });

        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("Failed to load map.");
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return (
    <div style={{ isolation: "isolate" }} className="relative h-[400px] w-full rounded-lg overflow-hidden border">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
      <div ref={mapDivRef} className="h-full w-full" />
    </div>
  );
}
