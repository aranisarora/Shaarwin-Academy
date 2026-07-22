// Single source of truth for the academy's service area. The academy operates
// across Bengaluru only, so coverage is a city-level check: any address within
// a generous metro radius of the city centre is served by every active coach;
// anything outside shows "we don't cover this area yet".

export const BENGALURU = { lat: 12.9716, lng: 77.5946 };

/** Metro radius (km) around the Bengaluru centre we treat as serviceable. */
export const BENGALURU_RADIUS_KM = 40;

const KM_PER_DEG = 111.32; // deg → km approximation, fine at city scale

/** True when (lat, lng) falls within greater Bengaluru. */
export function isWithinBengaluru(lat: number, lng: number): boolean {
  const dLat = (BENGALURU.lat - lat) * KM_PER_DEG;
  const dLng = (BENGALURU.lng - lng) * KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng) <= BENGALURU_RADIUS_KM;
}
