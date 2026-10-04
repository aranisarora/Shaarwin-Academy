"use client";

import { useSignedIn } from "@/components/marketing/useSignedIn";
import { ButtonLink } from "@/components/ui/Button";

type Variant = "primary" | "ghost" | "destructive";
type Size = "md" | "lg";

/**
 * Auth-aware CTA for the (statically rendered) marketing homepage. The page
 * itself can't read the auth cookie without opting into dynamic rendering, so
 * this island checks the session cookie client-side and swaps the link. It renders the
 * signed-out variant during SSR/prerender, then upgrades on hydration for
 * signed-in visitors.
 */
export function AuthCta({
  signedInHref,
  signedOutHref,
  signedInLabel,
  signedOutLabel,
  children,
  variant,
  size,
  className,
}: {
  signedInHref: string;
  signedOutHref: string;
  signedInLabel?: React.ReactNode;
  signedOutLabel?: React.ReactNode;
  /** Static content shown for both states (used when labels are identical). */
  children?: React.ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  const signedIn = useSignedIn();

  return (
    <ButtonLink
      href={signedIn ? signedInHref : signedOutHref}
      variant={variant}
      size={size}
      className={className}
    >
      {children ?? (signedIn ? signedInLabel : signedOutLabel)}
    </ButtonLink>
  );
}
