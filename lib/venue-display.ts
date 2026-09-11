// How a location is spelled, everywhere.
//
// A venue and the unit inside it are two fields, not one string to be parsed:
// "Adarsh Palm Retreat" has villas and towers whose clubhouses are mutually
// inaccessible, so the unit is part of the name rather than decoration.

/** The venue fields that decide how it's named. */
export type VenueNameParts = { name: string; unit?: string | null };

/**
 * "Adarsh Palm Retreat" + "Villas" → "Adarsh Palm Retreat Villas".
 *
 * The unit reads as a suffix of the name, so it joins with a space.
 */
export function venueDisplayName(v: VenueNameParts): string {
  const unit = v.unit?.trim();
  return unit ? `${v.name.trim()} ${unit}` : v.name.trim();
}
