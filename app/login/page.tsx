import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { StageShell } from "@/components/shells/StageShell";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { roleHome } from "@/lib/access-gates";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage() {
  // An already-signed-in visitor goes to their own app, not always to /app.
  // The proxy would correct a wrong guess on the next hop, but that is a second
  // round trip for a coach, a founder or a school to reach their own home.
  const user = await getCurrentUser();
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    redirect(roleHome(data?.role));
  }

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
