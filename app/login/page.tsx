import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout, AuthAlternative } from "@/components/auth/AuthLayout";
import { AuthForm } from "@/components/auth/AuthForm";
import { redirectSignedInHome } from "@/lib/auth";

export const metadata: Metadata = { title: "Log in" };

/**
 * The general way in. Everything on it is for a parent — a code to their inbox,
 * or Google — and the audience that can use neither is sent onward from the
 * block at the foot rather than served by a hidden step in the middle.
 *
 * "Log in with a password" is kept as the wording of the school link on purpose.
 * Messages sent before this change tell schools to open this page and choose
 * exactly that, and those messages are sitting in WhatsApp threads on phones we
 * cannot reach. The phrase still appears, still on this page, and now leads
 * somewhere better than a third step in a form.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await redirectSignedInHome();
  const { error } = await searchParams;

  return (
    <AuthLayout
      title="Welcome back"
      lead="Enter your email and we'll send you a six-digit code."
      // `/auth/callback` has redirected here with ?error=auth since it was
      // written, and until now nothing read it: a failed Google hop dropped the
      // visitor on a blank login form with no sign anything had gone wrong.
      notice={
        error === "auth"
          ? "We couldn't finish that sign-in. Try again below, or use a code instead."
          : undefined
      }
      alternatives={
        <>
          <AuthAlternative
            question="Signing in for a school?"
            href="/login/school"
            label="Log in with a password"
          />
          <AuthAlternative
            question="New here?"
            href="/signup"
            label="Create an account"
          />
        </>
      }
    >
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </AuthLayout>
  );
}
