"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { AddressSearch, type GeocodeHit } from "@/components/app/AddressSearch";
import { saveCoachProfile } from "@/app/coach/more/actions";

export function CoachProfileEditor({
  fullName,
  bio,
  baseLat,
  baseLng,
  radiusKm,
}: {
  fullName: string;
  bio: string;
  baseLat: number;
  baseLng: number;
  radiusKm: number;
}) {
  const [form, setForm] = useState({ bio, baseLat, baseLng, radiusKm });
  const [addressQuery, setAddressQuery] = useState("");
  const [addressSelected, setAddressSelected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mapContainer = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
      if (!token || !mapContainer.current) return;
      const mapboxgl = (await import("mapbox-gl")).default;
      await import("mapbox-gl/dist/mapbox-gl.css");
      if (cancelled || !mapContainer.current) return;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [baseLng, baseLat],
        zoom: 11,
        attributionControl: false,
      });
      mapRef.current = map;
      const el = document.createElement("div");
      el.style.cssText =
        "width:20px;height:20px;border-radius:999px;background:#E8590C;border:3px solid #F4F1EA;cursor:grab;box-shadow:0 0 0 6px rgb(232 89 12 / 0.25)";
      const marker = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([baseLng, baseLat])
        .addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        setForm((f) => ({ ...f, baseLat: pos.lat, baseLng: pos.lng }));
      });
      markerRef.current = marker;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickAddress(hit: GeocodeHit) {
    const [lng, lat] = hit.center;
    setForm((f) => ({ ...f, baseLat: lat, baseLng: lng }));
    setAddressQuery(hit.place_name);
    setAddressSelected(true);
    markerRef.current?.setLngLat([lng, lat]);
    mapRef.current?.easeTo({ center: [lng, lat], zoom: 14 });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="label mb-1">Coach</p>
        <p className="font-display text-2xl">{fullName}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="coach-bio" className="label">
          Bio (shown on the public coaches page)
        </label>
        <textarea
          id="coach-bio"
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
          rows={3}
          className="rounded-[8px] border border-line bg-surface-2 p-3.5 text-base"
        />
      </div>

      <div>
        <p className="label mb-2">Base location — type an address or drag the pin</p>
        <div className="mb-3">
          <AddressSearch
            label="Search your address"
            placeholder="Start typing your address…"
            query={addressQuery}
            selected={addressSelected}
            onQueryChange={(q) => {
              setAddressQuery(q);
              setAddressSelected(false);
            }}
            onSelect={pickAddress}
          />
        </div>
        <div
          ref={mapContainer}
          className="mb-3 h-56 overflow-hidden rounded-[12px] border border-line"
        />
        <Input
          label="Travel radius (km)"
          type="number"
          min={1}
          max={50}
          value={form.radiusKm}
          onChange={(e) => setForm({ ...form, radiusKm: Number(e.target.value) })}
        />
      </div>

      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await saveCoachProfile(form);
            setMessage(r.ok ? "Saved." : (r.error ?? "Save failed."));
          })
        }
        className="w-full"
      >
        {pending ? <Spinner /> : "Save profile"}
      </Button>
      {message && <p className="text-sm text-fg-2">{message}</p>}
    </div>
  );
}
