"use client";

/**
 * Client-side WhatsApp CTA: a wa.me deep link that opens the assistant chat
 * with a prefilled message. The account is already bound to its confirmed
 * number (wa_links, written when the phone is saved), so no handshake is
 * needed — but the first inbound message opens the 24h WhatsApp session
 * window, letting the assistant reply free-form instead of via template.
 * Renders nothing if no bot number is configured.
 */
export function WhatsAppSayHi({
  message = "Hi! I'd like to get my class updates on WhatsApp.",
  label = "Notify me on WhatsApp",
}: {
  message?: string;
  label?: string;
}) {
  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  if (!number) return null;

  const href = `https://wa.me/${number.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border border-line px-5 font-semibold hover:border-ember"
    >
      {label}
    </a>
  );
}
