import { ButtonLink } from "@/components/ui/Button";
import { whatsappLink } from "@/lib/contact";

/**
 * The site's only call to action.
 *
 * There is no sign-up, no login and no booking screen here any more: booking,
 * cancelling and asking a question all happen in one WhatsApp thread with the
 * academy's assistant. Every CTA on the marketing pages goes through this
 * component so the number and the prefilled workspace key are set in one place.
 */
export function WhatsAppCta({
  message,
  children = "Book or ask on WhatsApp",
  variant,
  size,
  className,
}: {
  /** The sentence prefilled under the workspace key. */
  message?: string;
  children?: React.ReactNode;
  variant?: "primary" | "ghost";
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <ButtonLink
      href={whatsappLink(message)}
      target="_blank"
      rel="noopener noreferrer"
      variant={variant}
      size={size}
      className={className}
    >
      {children}
    </ButtonLink>
  );
}
