import { NavigateButton } from "@/components/app/NavigateButton";
import type { StructuredAddress } from "@/lib/address";

/**
 * Consistent read-side rendering of a StructuredAddress for every stakeholder.
 * `audience="staff"` (coach / founder) additionally surfaces the private entry
 * notes; `audience="public"` (other clients, marketing) never does. Renders an
 * "Open maps" link whenever coordinates are known. Server-safe (no client JS).
 */
export function AddressDisplay({
  address,
  audience = "public",
  showMaps = true,
  className = "",
}: {
  address: StructuredAddress;
  audience?: "public" | "staff";
  showMaps?: boolean;
  className?: string;
}) {
  const staff = audience === "staff";
  const unit = [address.flat, address.building].filter(Boolean).join(", ");

  return (
    <div className={`space-y-0.5 text-sm ${className}`}>
      {unit && <p className="text-fg">{unit}</p>}
      {address.floorTower && <p className="text-fg-2">{address.floorTower}</p>}
      {address.formatted && <p className="text-fg-2">{address.formatted}</p>}
      {address.landmark && (
        <p className="text-fg-2">Near {address.landmark}</p>
      )}
      {address.postcode && !address.formatted.includes(address.postcode) && (
        <p className="text-fg-2">{address.postcode}</p>
      )}
      {staff && address.accessNotes && (
        <p className="mt-1 rounded-[8px] border border-line bg-surface-2 px-3 py-2 text-fg">
          <span className="label mr-1">Entry</span>
          {address.accessNotes}
        </p>
      )}
      {showMaps && (
        <NavigateButton lat={address.lat} lng={address.lng} className="mt-1" />
      )}
    </div>
  );
}
