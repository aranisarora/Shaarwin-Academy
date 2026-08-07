// How a location is spelled, everywhere. There is no resolver here any more:
// the venue and the unit inside it are chosen by a human at booking and stored
// (migrations 0052-0054), so every surface reads the same two fields rather
// than each parsing its own answer out of a geocoded address string.
//
// The authority is `location_label(classes)` in Postgres, which the notify
// worker and the app pages both read as a PostgREST computed field. These
// helpers exist for the two cases that have no class row to read it from:
// rendering a venue picker, and previewing a label before the session exists.

import { asAddressDetails, type StructuredAddress } from "@/lib/address";

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

/** The venue fields that decide how it's named. */
export type VenueNameParts = { name: string; unit?: string | null };

/**
 * "Adarsh Palm Retreat" + "Villas" → "Adarsh Palm Retreat Villas".
 *
 * The unit reads as a suffix of the name, so it joins with a space. Mirrors
 * `venue_display(venues)` in SQL — change one, change the other.
 *
 * The unit is not decoration. One complex can hold several venues that are
 * mutually inaccessible: a resident of the villas cannot get into the towers'
 * clubhouse, or the reverse. A venue that shares its name with another must
 * therefore carry a unit, which `venueNeedsUnit` below enforces at the point of
 * editing.
 */
export function venueDisplayName(v: VenueNameParts): string {
  const unit = v.unit?.trim();
  return unit ? `${v.name.trim()} ${unit}` : v.name.trim();
}

/**
 * The venue half of a location label — what the Location filter filters on.
 *
 * `location_label(classes)` is "venue, unit" and the unit only exists for a
 * private (it reads `private_class_details.unit_label`), so This week labels a
 * family's Tuesday "Adarsh Palm Retreat Villas, Villa 659" while the Timetable
 * lists the same slot under "Adarsh Palm Retreat Villas". Two spellings of one
 * place, which is fine while each view owns its own filter and wrong the moment
 * one filter drives both. The founder picking a location means the place, not
 * the doorway, so the doorway comes off.
 */
export function venueKeyOf(label: string | null | undefined): string {
  const s = label?.trim();
  if (!s) return "";
  const comma = s.indexOf(", ");
  return comma === -1 ? s : s.slice(0, comma);
}

/**
 * Venue plus where inside it — the string a coach reads. Mirrors
 * `location_label(classes)`.
 */
export function composeLocationLabel(
  venue: string | null | undefined,
  unit?: string | null
): string | null {
  const v = venue?.trim();
  if (!v) return null;
  const u = unit?.trim();
  return u ? `${v}, ${u}` : v;
}

/**
 * Turn the fields a client fills in — floor/tower and flat — into the unit
 * string stored on the session. Mirrors step 4 of migration 0053, so a session
 * booked today reads the same as one backfilled from the old data.
 *
 * A bare number reads as a flat ("171" → "flat 171"); anything else is already
 * a noun and is left alone ("Villa 659", "clubhouse"). Only the first character
 * of the whole phrase is capitalised, so "flat" leads as "Flat 171" but reads
 * as prose mid-phrase ("Tower 1, flat 171").
 */
export function composeUnitLabel(
  floorTower?: string | null,
  flat?: string | null
): string | null {
  const tower = floorTower?.trim();
  const raw = flat?.trim();
  const unit = raw ? (/^\d+$/.test(raw) ? `flat ${raw}` : raw) : null;
  const phrase = [tower, unit].filter(Boolean).join(", ");
  if (!phrase) return null;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * Would saving this venue leave two venues sharing a name with no unit to tell
 * them apart? `others` is every OTHER venue (exclude the one being edited).
 *
 * This is the guard behind the clubhouse problem: as soon as a complex has more
 * than one venue, a bare complex name can't be selected, so a session there can
 * never be labelled with an ambiguous unit like "Clubhouse" alone.
 */
export function venueNeedsUnit(
  candidate: VenueNameParts,
  others: VenueNameParts[]
): boolean {
  if (candidate.unit?.trim()) return false;
  const name = candidate.name.trim().toLowerCase();
  return others.some((o) => o.name.trim().toLowerCase() === name);
}
