// Great-circle distance between two lat/lng points, in metres. Used to check
// whether a coach opening a session page is physically at the venue (geofenced
// auto-arrival). Small and dependency-free — accuracy is plenty for a fence of
// a few hundred metres.

/**
 * How close counts as "at the venue".
 *
 * 500 m, widened from 150 m. The 150 was chosen for the apartment-complex
 * venues, where the stored point sits roughly on the court. Most sessions are
 * not those: 42% of the last 30 days are school classes, and a campus is a
 * single geocoded point covering grounds a coach can easily stand 200–400 m
 * from — in a sports hall, on the far side of the buildings, with a fix degraded
 * by the roof over their head. At 150 m the honest answer for those was "not
 * here yet" while the coach was demonstrably standing in the venue.
 *
 * Note what the fence is *for*. It does not decide whether the coach is
 * trusted — it decides whether the app can mark arrival without being asked,
 * and a 10-minute Undo sits behind it. So the cost of being slightly too wide
 * is an Undo, and the cost of being too narrow is the whole feature never
 * firing, which is what production actually showed.
 *
 * Every attempt logs its distance and the fence in force at the time
 * (lib/arrival-fix.ts writes `fence_m`), so rows from before and after this
 * change stay comparable and the next move can be made from the spread rather
 * than from reasoning like the paragraph above.
 *
 * It lives here because the check runs on the session page and on the coach home
 * now. Two copies of a fence width is two different answers to "am I there yet".
 */
export const GEOFENCE_M = 500;

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
