// Shared Mapbox forward-geocoding for the bot's location-aware tools
// (private-session addresses, venue creation).

export type GeoHit = { lat: number; lng: number; place: string };

export async function geocode(address: string): Promise<GeoHit | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!token || !address.trim()) return null;
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      address
    )}.json?limit=1&country=in&proximity=77.5946,12.9716&access_token=${token}`
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    features?: { center: [number, number]; place_name: string }[];
  };
  const hit = json.features?.[0];
  return hit ? { lat: hit.center[1], lng: hit.center[0], place: hit.place_name } : null;
}
