// Great-circle distance between two lat/lng points, in metres. Used to check
// whether a coach opening a session page is physically at the venue (geofenced
// auto-arrival). Small and dependency-free — accuracy is plenty for a ~150 m
// fence.

/**
 * How close counts as "at the venue".
 *
 * Deliberately still 150 m. Only 5 of 42 manual arrivals in production had
 * recorded a distance at all, which is not a distribution — it is five numbers,
 * and moving a fence on five numbers is guessing with extra steps. Every attempt
 * now logs its distance whether or not it lands inside (see lib/arrival-fix.ts),
 * so this constant should be set from the real spread after a week of that, not
 * before.
 *
 * It lives here because the check runs on the session page and on the coach home
 * now. Two copies of a fence width is two different answers to "am I there yet".
 */
export const GEOFENCE_M = 150;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
