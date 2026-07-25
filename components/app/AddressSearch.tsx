"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/Input";

export type GeocodeHit = {
  name?: string; // short POI name (e.g., "La Plazzo") — only set for poi results
  place_name: string;
  center: [number, number];
  postcode: string;
  // Extra context parsed from the /retrieve response so callers can prefill a
  // structured address. All optional — older callers read only the three above.
  locality?: string;
  city?: string;
  state?: string;
  country?: string;
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
 * Parse one Search Box feature (from /retrieve or /reverse) into a GeocodeHit.
 * The single source of truth for turning a Mapbox feature into our hit shape —
 * the typeahead's `choose`, the "use my location" reverse-geocode and the
 * "find on map" fallback all funnel through here so they can't drift apart.
 */
export function featureToGeocodeHit(feat: unknown): GeocodeHit | null {
  const f = feat as {
    properties?: Record<string, unknown>;
    geometry?: { coordinates?: [number, number] };
  } | null;
  if (!f?.geometry?.coordinates) return null;
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const ctx = (p.context ?? {}) as Record<string, { name?: string }>;
  return {
    // Only carry the short name for POI results; for streets/addresses it
    // would just be the road name, which isn't a useful display label.
    name: p.feature_type === "poi" ? ((p.name as string) ?? undefined) : undefined,
    place_name:
      (p.full_address as string) ||
      [p.name, p.place_formatted].filter(Boolean).join(", "),
    center: f.geometry.coordinates,
    postcode: ctx.postcode?.name ?? "",
    // Bengaluru results expose area under neighborhood/locality; city under
    // place, state under region. Any may be absent for a sparse result.
    locality: ctx.neighborhood?.name ?? ctx.locality?.name ?? undefined,
    city: ctx.place?.name ?? undefined,
    state: ctx.region?.name ?? undefined,
    country: ctx.country?.name ?? undefined,
  };
}

/**
 * Reverse-geocode raw coordinates (the "use my current location" path). Returns
 * the first feature as a GeocodeHit, or null if there's no token / no result.
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<GeocodeHit | null> {
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!accessToken) return null;
  try {
    const res = await fetch(
      `${BASE}/reverse?longitude=${lng}&latitude=${lat}` +
        `&language=en&access_token=${accessToken}`
    );
    const body = await res.json();
    return featureToGeocodeHit(body.features?.[0] ?? null);
  } catch {
    return null;
  }
}

/**
 * Resolve free-typed / autofilled / pasted text to a pinned hit by running
 * /suggest and auto-retrieving the top match (the "find this address on the
 * map" fallback). Uses the same session-token pairing as the typeahead.
 */
export async function resolveTopSuggestion(
  query: string
): Promise<GeocodeHit | null> {
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!accessToken || query.trim().length < 3) return null;
  const session = crypto.randomUUID();
  try {
    const sres = await fetch(
      `${BASE}/suggest?q=${encodeURIComponent(query)}` +
        `&country=in&proximity=${PROXIMITY}&language=en&limit=1` +
        `&types=poi,address,street,neighborhood,locality,place,postcode` +
        `&session_token=${session}&access_token=${accessToken}`
    );
    const sbody = await sres.json();
    const top = sbody.suggestions?.[0];
    if (!top?.mapbox_id) return null;
    const rres = await fetch(
      `${BASE}/retrieve/${top.mapbox_id}` +
        `?session_token=${session}&access_token=${accessToken}`
    );
    const rbody = await rres.json();
    return featureToGeocodeHit(rbody.features?.[0] ?? null);
  } catch {
    return null;
  }
}

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
  label?: React.ReactNode;
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
      const hit = featureToGeocodeHit(body.features?.[0] ?? null);
      if (hit) onSelect(hit);
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
