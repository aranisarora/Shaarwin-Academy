import Link from "next/link";

/**
 * Understated "Open maps" link that opens Google Maps directions to the session
 * location. Deliberately low-key so it doesn't compete with the date, time and
 * venue. Renders nothing when coordinates are unknown. Sits above a card's
 * overlay link (z-10) so it stays independently clickable.
 */
export function NavigateButton({
  lat,
  lng,
  className = "",
}: {
  lat: number | null;
  lng: number | null;
  className?: string;
}) {
  if (lat === null || lng === null) return null;
  return (
    <Link
      href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
      target="_blank"
      rel="noreferrer"
      className={`relative z-10 inline-flex items-center gap-1 text-sm text-fg-2 underline decoration-line underline-offset-4 hover:text-ember hover:decoration-ember ${className}`}
    >
      ↗ Open maps
    </Link>
  );
}
