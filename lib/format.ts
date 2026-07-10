// Client-safe formatting helpers (lib/data.ts imports the server Supabase
// client, so client components import from here instead).

/** `pence` holds paise (minor unit of INR). */
export function formatPrice(pence: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(pence / 100);
}
