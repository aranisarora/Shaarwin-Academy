"use client";

/**
 * Client-side WhatsApp CTA: a wa.me deep link that opens the assistant chat
 * with a prefilled message. No link code — onboarding captures the client's
 * phone, so the bot recognises the number and auto-links on the first
 * inbound message (resolveIdentity's profiles.phone fallback). That first
 * message is also what opens the WhatsApp session window, letting the
 * assistant send updates. Renders nothing if no bot number is configured.
 */
export function WhatsAppSayHi({
  message = "Hi! I'd like to get my class updates on WhatsApp.",
}: {
  message?: string;
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
      Say hi on WhatsApp — get updates in chat
    </a>
  );
}
