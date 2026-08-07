import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { SchoolLinkEntry } from "@/components/auth/SchoolLinkEntry";
import { redirectSignedInHome } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Signing you in",
  // Nothing here is for the public, and this is the one route whose whole
  // purpose is to be arrived at from a message.
  robots: { index: false, follow: false },
};

/**
 * The screen a tap-to-enter link opens.
 *
 * It renders no credential and receives none: the link carries it in the URL
 * fragment, which never reaches this server component at all. Everything that
 * matters happens in `SchoolLinkEntry`, in the browser.
 *
 * `redirectSignedInHome` still runs first, and for a school that is exactly
 * right — somebody who taps the link on a phone that is already signed in wants
 * to end up at the roster, which is where it sends them. It is also why the
 * founder cannot test this link while signed in as the founder: he is sent to
 * /admin before the page renders, so the sheet tells him to use a private
 * window.
 */
export default async function SchoolEnterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await redirectSignedInHome();
  const { next } = await searchParams;

  // Only our own paths. Handing an arbitrary absolute URL to `location.replace`
  // after a successful sign-in is an open redirect wearing a login page as a
  // disguise.
  const safeNext =
    next?.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <AuthLayout title="Signing you in" lead="One moment — opening your school's pupils.">
      <SchoolLinkEntry next={safeNext} />
    </AuthLayout>
  );
}
