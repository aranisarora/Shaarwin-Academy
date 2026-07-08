"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/Input";

export type GeocodeHit = {
  place_name: string;
  center: [number, number];
  postcode: string;
};

/** A /suggest candidate — no coordinates yet; those come from /retrieve. */
type Suggestion = {
  mapbox_id: string;
  name: string;
  place_formatted: string;
};

const BASE = "https://api.mapbox.com/search/searchbox/v1";
// Bengaluru city centre — biases the typeahead toward local results so a
// bare "windmills" surfaces the Bengaluru venue, not a windmill in Pune.
const PROXIMITY = "77.5946,12.9716";

/**
 * Debounced Mapbox address/venue autocomplete (Bengaluru-biased).
 *
 * Uses the Search Box API (/suggest → /retrieve), which is POI/business-first
 * and far better at named venues than the older geocoding endpoint. A single
 * session token spans the whole typeahead session (every /suggest plus the
 * final /retrieve) so Mapbox bills and caches them as one interaction.
 *
 * Controlled: parent owns the query text; `selected` suppresses searching once
 * an address has been picked, until the user types again.
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // Lazily created and rotated after each selection; only ever touched inside
  // the effect and the click handler, never during render.
  const sessionToken = useRef<string | null>(null);
  const token = () =>
    (sessionToken.current ??= crypto.randomUUID());

  useEffect(() => {
    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    // AbortController guards against out-of-order responses: a slow reply for an
    // earlier keystroke can't overwrite the results of a later one.
    const controller = new AbortController();
    const t = setTimeout(async () => {
      if (!accessToken || query.trim().length < 3 || selected) {
        setSuggestions([]);
        return;
      }
      try {
        const res = await fetch(
          `${BASE}/suggest?q=${encodeURIComponent(query)}` +
            `&country=in&proximity=${PROXIMITY}&language=en&limit=6` +
            `&types=poi,address,street,neighborhood,locality,place,postcode` +
            `&session_token=${token()}&access_token=${accessToken}`,
          { signal: controller.signal }
        );
        const body = await res.json();
        setSuggestions(
          (body.suggestions ?? []).slice(0, 6).map(
            (s: {
              mapbox_id: string;
              name: string;
              place_formatted?: string;
              full_address?: string;
            }) => ({
              mapbox_id: s.mapbox_id,
              name: s.name,
              place_formatted: s.place_formatted ?? s.full_address ?? "",
            })
          )
        );
      } catch {
        // Aborted or network error — ignore; the next keystroke retries.
      }
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, selected]);

  async function choose(s: Suggestion) {
    const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    setSuggestions([]);
    if (!accessToken) return;
    try {
      const res = await fetch(
        `${BASE}/retrieve/${s.mapbox_id}` +
          `?session_token=${token()}&access_token=${accessToken}`
      );
      const body = await res.json();
      const feat = body.features?.[0];
      if (!feat) return;
      const p = feat.properties ?? {};
      onSelect({
        place_name:
          p.full_address ||
          [p.name, p.place_formatted].filter(Boolean).join(", "),
        center: feat.geometry.coordinates as [number, number],
        postcode: p.context?.postcode?.name ?? "",
      });
    } catch {
      // Retrieve failed — drop it; the user can pick again.
    } finally {
      // Selection ends the session; the next search starts a fresh one.
      sessionToken.current = crypto.randomUUID();
    }
  }

  return (
    <div className="relative">
      <Input
        label={label}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[8px] border border-line bg-surface-2 shadow-[var(--shadow-sheet)]">
          {suggestions.map((s) => (
            <li key={s.mapbox_id}>
              <button
                onClick={() => choose(s)}
                className="w-full px-3.5 py-2.5 text-left hover:bg-surface"
              >
                <span className="block text-sm">{s.name}</span>
                {s.place_formatted && (
                  <span className="block text-xs text-fg-2">
                    {s.place_formatted}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
