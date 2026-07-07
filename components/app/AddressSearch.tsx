"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";

export type GeocodeHit = {
  place_name: string;
  center: [number, number];
  postcode: string;
};

/**
 * Debounced Mapbox address autocomplete (Bengaluru-biased).
 * Controlled: parent owns the query text; `selected` suppresses searching
 * once an address has been picked, until the user types again.
 */
export function AddressSearch({
  label = "Address",
  placeholder,
  query,
  selected,
  onQueryChange,
  onSelect,
}: {
  label?: string;
  placeholder?: string;
  query: string;
  selected: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (hit: GeocodeHit) => void;
}) {
  const [hits, setHits] = useState<GeocodeHit[]>([]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token || query.length < 5 || selected) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=in&proximity=77.5946,12.9716&types=address,poi,locality,neighborhood,postcode&access_token=${token}`
        );
        const body = await res.json();
        setHits(
          (body.features ?? []).slice(0, 5).map(
            (f: {
              place_name: string;
              center: [number, number];
              context?: { id: string; text: string }[];
            }) => ({
              place_name: f.place_name,
              center: f.center,
              postcode:
                f.context?.find((c) => c.id.startsWith("postcode"))?.text ?? "",
            })
          )
        );
      } catch {
        setHits([]);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, selected]);

  return (
    <div className="relative">
      <Input
        label={label}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {hits.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[8px] border border-line bg-surface-2 shadow-[var(--shadow-sheet)]">
          {hits.map((hit) => (
            <li key={hit.place_name}>
              <button
                onClick={() => {
                  setHits([]);
                  onSelect(hit);
                }}
                className="w-full px-3.5 py-2.5 text-left text-sm hover:bg-surface"
              >
                {hit.place_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
