// Where the academy is reached. Everything that used to be a "Sign in" or a
// "Book a class" button is now one of these.
//
// The academy's WhatsApp is answered by bluetick, which hosts many businesses
// on one number: the first thing a message carries has to be the workspace key,
// or the assistant cannot tell which academy the sender means. That is why
// every link built here leads with the key and puts the human sentence, if
// there is one, on the line below.

/** Digits only — wa.me will not accept "+" or spaces. */
export const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "12402623933";

/** The bluetick workspace key, the first line of every prefilled message. */
export const BLUETICK_KEY = process.env.NEXT_PUBLIC_BLUETICK_KEY ?? "";

export const CONTACT_EMAIL = "stalin@sharwinacademy.com";

/** "12402623933" → "+1 240 262 3933" — for display only. */
export function displayWhatsappNumber(digits = WHATSAPP_NUMBER): string {
  const d = digits.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) {
    return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  }
  if (d.length === 12 && d.startsWith("91")) {
    return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  }
  return `+${d}`;
}

/**
 * A wa.me link to the academy's assistant, prefilled with the workspace key and
 * an optional sentence saying what the visitor came for.
 */
export function whatsappLink(message?: string): string {
  const text = [BLUETICK_KEY, message].filter(Boolean).join("\n");
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${WHATSAPP_NUMBER}${query}`;
}
