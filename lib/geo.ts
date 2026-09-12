// Great-circle distance between two lat/lng points, in metres. Small and
// dependency-free.
//
// This used to carry a GEOFENCE_M as well, for marking a coach arrived without
// being asked once their device put them inside it. That is gone: the fence
// only ever fired while the app was open, where the coach could as easily press
// the button, and the case it was built for — the app closed, at the venue —
// is not reachable from a browser at all. The one caller left is the private
// booking wizard, ranking venues by how near they are to a pin.

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
