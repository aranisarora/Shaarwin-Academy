// One place that turns a private class's raw client address into the short,
// trustworthy venue/POI name every surface shows ("La Palazzo", not
// "47/1, Bengaluru…"). Used by the schedule card, the session sheet header and
// the client-side week refetch so they never disagree.

import { asAddressDetails, type StructuredAddress } from "@/lib/address";

export type VenueLike = {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
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
  lat: number | null;
  lng: number | null;
  /** Raw jsonb — narrowed here, since only the POI `name` is read. */
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
 * Build a resolver from the known venues. Resolution order, most trustworthy
 * first:
 *   1. exact (normalised) address match against a known venue
 *   2. geocoded POI name (`address_details.name`) — a real place name beats a
 *      near-miss venue
 *   3. nearest known venue within ~150m (Manhattan distance < 0.002)
 *   4. first comma segment of the raw address — never the whole comma-run
 * Returns null only when there's nothing at all to show.
 */
export function makeVenueResolver(venues: VenueLike[]) {
  const byAddress = new Map<string, string>();
  for (const v of venues) {
    if (v.address) byAddress.set(normAddress(v.address), v.name);
  }

  const near = (lat: number | null, lng: number | null): string | null => {
    if (lat === null || lng === null) return null;
    let best: { name: string; d: number } | null = null;
    for (const v of venues) {
      if (v.lat === null || v.lng === null) continue;
      const d = Math.abs(v.lat - lat) + Math.abs(v.lng - lng);
      if (d < 0.002 && (!best || d < best.d)) best = { name: v.name, d };
    }
    return best?.name ?? null;
  };

  return function resolve(priv: PrivLocation): string | null {
    const addr = (priv.address ?? "").trim();
    if (addr) {
      const exact = byAddress.get(normAddress(addr));
      if (exact) return exact;
    }
    const poi = asAddressDetails(priv.address_details)?.name?.trim();
    if (poi) return poi;
    const nearName = near(priv.lat, priv.lng);
    if (nearName) return nearName;
    if (!addr) return null;
    return addr.includes(",") ? addr.split(",")[0].trim() : addr;
  };
}
