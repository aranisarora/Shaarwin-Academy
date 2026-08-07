import type { Metadata } from "next";
import { AuthLayout, AuthAlternative } from "@/components/auth/AuthLayout";
import { SchoolSignInForm } from "@/components/auth/SchoolSignInForm";
import { redirectSignedInHome } from "@/lib/auth";

export const metadata: Metadata = {
  title: "School log in",
  // Nothing here is for the public, and a search result for a page whose only
  // purpose is to receive a link would be noise at best.
  robots: { index: false, follow: false },
};

/**
 * The screen at the end of the handover link.
 *
 * A school never chooses to be here — it is sent here, by the message
 * `lib/school-handover.ts` composes, with `?email=` already carrying half the
 * credential. So this page owes that message two things: it must open on the
 * right form with the address filled in, and it must not mention any way in
 * that doesn't exist for a school account.
 *
 * `next` is honoured because the proxy adds it when a school taps a deep link
 * into `/school/...` while signed out, and losing it would land them on the
 * roster with no idea what they had clicked.
 */
export default async function SchoolLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  await redirectSignedInHome();
  const { email, next } = await searchParams;

  // Only our own paths. `next` reaches this page from a query string, and
  // handing an arbitrary absolute URL to `location.replace` after a successful
  // sign-in is an open redirect wearing a login page as a disguise.
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <AuthLayout
      title="School log in"
      lead="Use the email and password we sent you. Anyone at the school can use the same login."
      alternatives={
        <>
          <AuthAlternative
            question="Lost the details, or need them changed?"
            href="https://wa.me/918431435758"
            label="Message us on WhatsApp"
          />
          <AuthAlternative
            question="Signing in as a parent instead?"
            href="/login"
            label="Log in with a code"
          />
        </>
      }
    >
      <SchoolSignInForm defaultEmail={email ?? ""} next={safeNext} />
    </AuthLayout>
  );
}
