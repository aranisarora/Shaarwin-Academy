import type { GeocodeHit } from "@/components/app/AddressSearch";

/**
 * A standardized, structured location shared across every stakeholder surface
 * (client, coach, founder). The geocoded base fields come from Mapbox; the
 * manual fields are the parts a geocoder can't know (which flat, which
 * building, how to get in). Persisted as `address_details jsonb` alongside the
 * flat `address`/`postcode`/`lat`/`lng` columns those tables already carry.
 *
 * Field set follows schema.org PostalAddress + Google's India address model
 * (subpremise + landmark) + the conventions Indian delivery apps use.
 */
export type AddressLabel = "home" | "work" | "other";

export type StructuredAddress = {
  // Geocoded base — `formatted` is the only field guaranteed present.
  name: string | null; // short POI display name (e.g., "La Plazzo"); null for plain addresses
  formatted: string;
  locality: string | null; // area / neighbourhood
  subLocality: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  // Manual — what a geocoder can't provide.
  flat: string | null; // flat / unit / house no.
  building: string | null; // apartment / society name
  floorTower: string | null; // floor / tower / block
  landmark: string | null;
  accessNotes: string | null; // how to get in — gate code, parking, which door
  label: AddressLabel;
};

export const EMPTY_ADDRESS: StructuredAddress = {
  name: null,
  formatted: "",
  locality: null,
  subLocality: null,
  city: null,
  state: null,
  postcode: null,
  country: null,
  lat: null,
  lng: null,
  flat: null,
  building: null,
  floorTower: null,
  landmark: null,
  accessNotes: null,
  label: "home",
};

/** Coalesce empty strings to null so blank inputs persist as null, not "". */
function orNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Build a StructuredAddress from the flat columns a legacy row still carries
 * (`address`, `postcode`, `lat`, `lng`, and optionally `access_notes`). Used
 * on the read side so rows written before the migration — or by paths that
 * only fill the flat line — still render through the shared display.
 */
export function fromLegacy(row: {
  address?: string | null;
  postcode?: string | null;
  lat?: number | null;
  lng?: number | null;
  access_notes?: string | null;
}): StructuredAddress {
  return {
    ...EMPTY_ADDRESS,
    formatted: row.address ?? "",
    postcode: orNull(row.postcode),
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    accessNotes: orNull(row.access_notes),
  };
}

/**
 * Merge a Mapbox geocode hit into an address, overwriting the geocoded base
 * (formatted line, area, city, state, postcode, country, coordinates) while
 * preserving any manual fields the user has already typed.
 */
export function applyGeocode(
  prev: StructuredAddress,
  hit: GeocodeHit
): StructuredAddress {
  const [lng, lat] = hit.center;
  return {
    ...prev,
    name: hit.name ?? null,
    formatted: hit.place_name,
    locality: hit.locality ?? null,
    city: hit.city ?? null,
    state: hit.state ?? null,
    postcode: hit.postcode || prev.postcode,
    country: hit.country ?? null,
    lat,
    lng,
  };
}

/** Normalize a possibly-partial persisted JSONB back into a full address. */
export function fromDetails(
  details: Partial<StructuredAddress> | null | undefined,
  fallback?: Parameters<typeof fromLegacy>[0]
): StructuredAddress {
  if (!details || !details.formatted) {
    return fallback ? fromLegacy(fallback) : EMPTY_ADDRESS;
  }
  return { ...EMPTY_ADDRESS, ...details };
}
