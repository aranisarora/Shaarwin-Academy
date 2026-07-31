// One place that turns a private class's raw client address into the short,
// trustworthy venue/POI name every surface shows ("La Palazzo", not
// "47/1, Bengaluru…"). Used by the schedule card, the session sheet header and
// the client-side week refetch so they never disagree.

import { asAddressDetails, type StructuredAddress } from "@/lib/address";

export type VenueLike = {
  name: string;
  address: string | null;
  /** Unused by the resolver since the distance tier was removed (see
   *  makeVenueResolver). Kept optional so the callers that select coordinates
   *  for geofencing can pass their rows straight through. */
  lat?: number | null;
  lng?: number | null;
};

/**
 * Narrow the `address_details` jsonb on a venue row selected straight from
 * Postgres. The three admin pages that list venues run the same select, so the
 * one cast from `Json` to the address shape lives here rather than at each.
 */
export function withVenueAddress<T extends { address_details: unknown }>(
  rows: T[] | null
): (Omit<T, "address_details"> & {
  address_details: Partial<StructuredAddress> | null;
})[] {
  return (rows ?? []).map((v) => ({
    ...v,
    address_details: asAddressDetails(v.address_details),
  }));
}

export type PrivLocation = {
  address: string | null;
  /** As on VenueLike: no longer read, kept so callers can pass rows through. */
  lat?: number | null;
  lng?: number | null;
  /** Raw jsonb — narrowed here; `name`, `locality` and `city` are read. */
  address_details?: unknown;
};

/** Lowercase, collapse whitespace, strip trailing commas/spaces — so a stray
 * space or trailing comma doesn't defeat the exact-address match. */
function normAddress(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[,\s]+$/g, "")
    .trim();
}

/**
 * First segment of an address. Splits on the ASCII comma AND U+060C ARABIC
 * COMMA: a third of the addresses on the book are geocoded with the latter, and
 * an ASCII-only split hands back the whole address as one "segment".
 */
export function addressHead(address: string | null | undefined): string | null {
  const head = (address ?? "").replace(/،/g, ",").split(",")[0].trim();
  return head || null;
}

/** City/state/country names that are never a useful location label on their own. */
const NOT_A_PLACE = new Set(["india", "bengaluru", "bangalore", "karnataka"]);

/**
 * A bare sub-unit designator inside a complex — "Phase 3", "Lane 1", "Sy No
 * 36/3". Real text, but meaningless without the complex name around it, so it
 * loses to the locality.
 */
const SUB_UNIT = /^(phase|lane|block|tower|wing|sector|sy\.?\s*no|survey\s*no)[\s.:-]*[0-9a-z/-]{0,6}$/i;

/** Is this segment worth showing on its own — i.e. somewhere a coach could drive to? */
export function isInformativePlace(
  segment: string | null,
  city: string | null | undefined
): boolean {
  if (!segment) return false;
  if (!/[A-Za-z]/.test(segment)) return false; // "51/3"
  const lower = segment.toLowerCase();
  if (NOT_A_PLACE.has(lower)) return false;
  if (city && lower === city.trim().toLowerCase()) return false;
  return !SUB_UNIT.test(segment);
}

/**
 * Build a resolver from the known venues. Resolution order, most trustworthy
 * first:
 *   1. exact (normalised) address match against a known venue
 *   2. geocoded POI name (`address_details.name`) — "Windmills of your mind"
 *   3. the first address segment, IF it names somewhere — a home private needs
 *      its street, so "Prestige Mayberry Road 34" beats the neighbourhood
 *   4. `address_details.locality` — the rescue when the address head is junk.
 *      Mapbox models a gated complex as a locality, so this is what turns
 *      "Bengaluru, 560103, India" into "Adarsh Palm Retreat".
 *   5. the address head, then the raw address
 *
 * **There is deliberately no distance tier.** The old "nearest venue within
 * ~150m" step is unsafe on this book: APR Tower 1 and APR Villas are 36 METRES
 * apart and four APR venues sit within 1.3km, so any radius wide enough to
 * catch a villa is wide enough to name the wrong building.
 *
 * `location_label(classes)` in the database mirrors this exactly (migration
 * 0050) — the notify worker reads it as a PostgREST computed field. Change one,
 * change the other.
 */
export function makeVenueResolver(venues: VenueLike[]) {
  const byAddress = new Map<string, string>();
  for (const v of venues) {
    if (v.address) byAddress.set(normAddress(v.address), v.name);
  }

  return function resolve(priv: PrivLocation): string | null {
    const addr = (priv.address ?? "").trim();
    if (addr) {
      const exact = byAddress.get(normAddress(addr));
      if (exact) return exact;
    }
    const details = asAddressDetails(priv.address_details);
    const poi = details?.name?.trim();
    if (poi) return poi;

    const head = addressHead(addr);
    if (isInformativePlace(head, details?.city)) return head;

    const locality = details?.locality?.trim();
    if (locality) return locality;

    return head ?? (addr || null);
  };
}
