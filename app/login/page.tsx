import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { StageShell } from "@/components/shells/StageShell";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/app");

  return (
    <StageShell>
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-6 pb-20 pt-32">
        <h1 className="font-display mb-2 text-4xl">Welcome back</h1>
        <p className="mb-8 text-fg-2">
          New here?{" "}
          <Link href="/signup" className="text-ember underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
      </div>
    </StageShell>
  );
}
