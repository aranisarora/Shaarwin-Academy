"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { AddressSearch, type GeocodeHit } from "@/components/app/AddressSearch";
import { saveVenue, setVenueActive, deleteVenue } from "@/app/admin/actions";

type Venue = {
  id: string;
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  active: boolean;
};

const BENGALURU = { lat: 12.9716, lng: 77.5946 };

export function VenueManager({ venues }: { venues: Venue[] }) {
  const [editing, setEditing] = useState<Partial<Venue> | null>(null);
  // Suppress the autocomplete dropdown until the founder actually types.
  const [addrSelected, setAddrSelected] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mapContainer = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);

  // Draggable pin map for the edit sheet
  useEffect(() => {
    if (!editing || !mapContainer.current) return;
    let cancelled = false;
    (async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
      if (!token) return;
      const mapboxgl = (await import("mapbox-gl")).default;
      await import("mapbox-gl/dist/mapbox-gl.css");
      if (cancelled || !mapContainer.current) return;
      mapboxgl.accessToken = token;
      const center: [number, number] = [
        editing.lng ?? BENGALURU.lng,
        editing.lat ?? BENGALURU.lat,
      ];
      const map = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center,
        zoom: editing.id ? 14 : 10,
        attributionControl: false,
      });
      mapRef.current = map;
      const el = document.createElement("div");
      el.style.cssText =
        "width:20px;height:20px;border-radius:999px;background:#E8590C;border:3px solid #F4F1EA;cursor:grab;box-shadow:0 0 0 6px rgb(232 89 12 / 0.25)";
      const marker = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat(center)
        .addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        setEditing((e) => (e ? { ...e, lat: pos.lat, lng: pos.lng } : e));
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
  }, [editing?.id, editing !== null]);

  function pickAddress(hit: GeocodeHit) {
    const [lng, lat] = hit.center;
    setEditing((e) =>
      e
        ? {
            ...e,
            address: hit.place_name,
            postcode: hit.postcode || e.postcode,
            lat,
            lng,
          }
        : e
    );
    setAddrSelected(true);
    markerRef.current?.setLngLat([lng, lat]);
    mapRef.current?.easeTo({ center: [lng, lat], zoom: 15 });
  }

  function submit() {
    if (!editing?.name || !editing.address || !editing.postcode) return;
    startTransition(async () => {
      const r = await saveVenue({
        id: editing.id,
        name: editing.name!,
        address: editing.address!,
        postcode: editing.postcode!,
        lat: editing.lat ?? BENGALURU.lat,
        lng: editing.lng ?? BENGALURU.lng,
      });
      setMessage(r.ok ? "Saved." : (r.error ?? "Save failed."));
      if (r.ok) setEditing(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="label">Venues</p>
        <Button
          onClick={() => {
            setEditing({});
            setAddrSelected(true);
          }}
        >
          New venue
        </Button>
      </div>
      {message && <p className="text-sm text-fg-2">{message}</p>}

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {venues.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <button
              onClick={() => {
                setEditing(v);
                setAddrSelected(true);
              }}
              className="text-left hover:text-ember"
            >
              <p className="font-medium">{v.name}</p>
              <p className="text-sm text-fg-2">
                {v.address} · {v.postcode}
              </p>
            </button>
            <div className="flex flex-col items-end gap-1.5">
              <Badge tone={v.active ? "ok" : "err"}>
                {v.active ? "shown on website" : "hidden"}
              </Badge>
              <button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await setVenueActive(v.id, !v.active);
                  })
                }
                className="text-xs text-fg-2 underline-offset-4 hover:underline"
              >
                {v.active ? "Hide venue" : "Show venue"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit venue" : "New venue"}
      >
        {editing && (
          <div className="space-y-4">
            <Input
              label="Name"
              value={editing.name ?? ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <AddressSearch
              placeholder="Start typing the venue address…"
              query={editing.address ?? ""}
              selected={addrSelected}
              onQueryChange={(q) => {
                setEditing({ ...editing, address: q });
                setAddrSelected(false);
              }}
              onSelect={pickAddress}
            />
            <Input
              label="Postcode"
              value={editing.postcode ?? ""}
              onChange={(e) => setEditing({ ...editing, postcode: e.target.value })}
            />
            <div>
              <p className="label mb-2">Drag the pin to the entrance</p>
              <div
                ref={mapContainer}
                className="h-56 overflow-hidden rounded-[12px] border border-line"
              />
            </div>
            <Button onClick={submit} disabled={pending} className="w-full">
              {pending ? <Spinner /> : "Save venue"}
            </Button>
            {editing.id && (
              <Button
                variant="destructive"
                disabled={pending}
                className="w-full"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Delete this venue for good? This only works if no classes use it."
                    )
                  )
                    return;
                  startTransition(async () => {
                    const r = await deleteVenue(editing.id!);
                    setMessage(r.ok ? "Venue deleted." : (r.error ?? "Delete failed."));
                    if (r.ok) setEditing(null);
                  });
                }}
              >
                Delete venue
              </Button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
