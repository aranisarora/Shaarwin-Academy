import type { StructuredAddress } from "@/lib/address";

/**
 * Render a StructuredAddress to plain text with a fixed, readable field order.
 * Pure (no JSX) so it's safe on the server and inside WhatsApp message bodies.
 *
 * Order: unit line (flat + building), floor/tower, formatted street line,
 * landmark, postcode. Access notes are appended only for staff (coach /
 * founder) via `includePrivate` — never leaked to other clients.
 */
export function formatAddress(
  a: StructuredAddress,
  opts: { includePrivate?: boolean } = {}
): string {
  const lines: string[] = [];

  const unit = [a.flat, a.building].filter(Boolean).join(", ");
  if (unit) lines.push(unit);
  if (a.floorTower) lines.push(a.floorTower);
  if (a.formatted) lines.push(a.formatted);
  if (a.landmark) lines.push(`Near ${a.landmark}`);
  if (a.postcode && !a.formatted.includes(a.postcode)) lines.push(a.postcode);

  if (opts.includePrivate && a.accessNotes) {
    lines.push(`Entry: ${a.accessNotes}`);
  }

  return lines.join("\n");
}
