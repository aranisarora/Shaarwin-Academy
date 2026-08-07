import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthLayout, AuthAlternative } from "@/components/auth/AuthLayout";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign up" };

/**
 * Signing up is only ever a family, so unlike `/login` this page keeps its own
 * "you are already signed in" redirect: whoever is here has no account yet, and
 * the /app hop is the right answer for the one case where they do.
 *
 * There is no school route out of here. A school does not sign itself up — the
 * founder mints its login and sends it — so offering the choice would be
 * offering a door with nothing behind it. The school link lives on `/login`,
 * which is where a school that has been sent a link actually lands.
 */
export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/app");

  return (
    <AuthLayout
      title="Take your place at the table"
      lead="Sign up and request access — we personally approve every new family."
      alternatives={
        <AuthAlternative
          question="Already a member?"
          href="/login"
          label="Log in"
        />
      }
    >
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </AuthLayout>
  );
}
