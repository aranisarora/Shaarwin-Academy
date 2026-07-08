// Phone normalization — the single source of truth for turning any inbound or
// stored phone string into a canonical E.164 form. Both sides of the identity
// handshake (storing a link and looking one up) MUST run through this, or a
// harmless format difference ("+91 98…" vs "+9198…") silently drops a user
// into guest mode.

/**
 * Canonicalize a phone number to E.164 ("+" followed by digits only).
 *
 * - Strips a leading "whatsapp:" transport prefix (defensive; callers usually
 *   strip it first).
 * - Removes spaces, dashes, parentheses, and dots.
 * - Converts an international "00" prefix to "+".
 * - Ensures a single leading "+".
 *
 * Returns null if what's left isn't a plausible E.164 number (7–15 digits),
 * so callers can treat garbage as "no match" rather than storing junk.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let s = raw.trim().replace(/^whatsapp:/i, "");
  // Drop everything that isn't a digit or a plus.
  s = s.replace(/[^\d+]/g, "");
  // International dialling prefix → E.164 plus.
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  // Collapse any stray plusses and force exactly one leading "+".
  const digits = s.replace(/\+/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}
