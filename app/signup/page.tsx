import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { StageShell } from "@/components/shells/StageShell";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/app");

  return (
    <StageShell>
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-6 pb-20 pt-32">
        <h1 className="font-display mb-2 text-4xl">Take your place at the table</h1>
        <p className="mb-2 text-fg-2">
          New here? Sign up and request access — we personally approve every new family.
        </p>
        <p className="mb-8 text-fg-2">
          Already a member?{" "}
          <Link href="/login" className="text-ember underline-offset-4 hover:underline">
            Log in
          </Link>
        </p>
        <Suspense>
          <AuthForm mode="signup" />
        </Suspense>
      </div>
    </StageShell>
  );
}
