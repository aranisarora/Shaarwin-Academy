// Where the academy is reached. Everything that used to be a "Sign in" or a
// "Book a class" button is now one of these.
//
// The academy's WhatsApp is answered by bluetick, which hosts many businesses
// on one number: a message has to carry the workspace key somewhere in it, or
// the assistant cannot tell which academy the sender means. Bluetick reads the
// key from anywhere in the text, so every link built here says what the visitor
// came for and closes with "With my code: <key>" — a sentence a person would
// send, rather than a code on a line of its own.

/** Digits only — wa.me will not accept "+" or spaces. */
export const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "12402623933";

/** The bluetick workspace key, carried at the end of every prefilled message. */
export const BLUETICK_KEY = process.env.NEXT_PUBLIC_BLUETICK_KEY ?? "";

/** What a visitor who tapped a button without a specific ask is sending. */
export const DEFAULT_MESSAGE = "Hi! I'd like to book table tennis classes.";

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
 * The text a prefilled thread opens with: the sentence saying what the visitor
 * came for, then the workspace key as its own clause. The key is the last
 * token and carries no punctuation after it — bluetick tokenises on anything
 * that is not a letter or a hyphen, so a trailing full stop would be harmless,
 * but the sentence reads better closed by the code itself.
 */
export function prefilledMessage(message: string = DEFAULT_MESSAGE): string {
  return BLUETICK_KEY ? `${message} With my code: ${BLUETICK_KEY}` : message;
}

/**
 * A wa.me link to the academy's assistant, prefilled with a sentence saying
 * what the visitor came for and the workspace key that names the academy.
 */
export function whatsappLink(message: string = DEFAULT_MESSAGE): string {
  const text = prefilledMessage(message);
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${WHATSAPP_NUMBER}${query}`;
}

/**
 * The thread itself, with nothing typed into it — for somebody who already has
 * the conversation on their phone: the founder, coming back from his schedule.
 * No sentence and no key, because bluetick already knows who he is.
 */
export function whatsappThreadLink(): string {
  return `https://wa.me/${WHATSAPP_NUMBER}`;
}
