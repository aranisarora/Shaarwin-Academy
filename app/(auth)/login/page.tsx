"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BRAND_NAME } from "@/config/operating-hours";
import Link from "next/link";
import Image from "next/image";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard/bookings";

  const handleGoogleSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-800 via-red-700 to-blue-950 px-4 relative overflow-hidden">
      {/* Decorative TT image */}
      <div className="absolute inset-0 opacity-[0.08] pointer-events-none">
        <Image src="/images/Group1.jpeg" alt="" fill className="object-cover" sizes="100vw" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo above card */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-white/25 shadow-xl">
            <Image
              src="/images/Logo.jpeg"
              alt={BRAND_NAME}
              width={80}
              height={80}
              className="object-cover w-full h-full"
            />
          </div>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-bold text-primary">{BRAND_NAME}</CardTitle>
            <CardDescription>Sign in to manage your bookings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pb-6">
            <Button
              onClick={handleGoogleSignIn}
              variant="outline"
              className="w-full gap-2 border-gray-200 hover:border-primary/30 hover:bg-primary/5"
              size="lg"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              New to {BRAND_NAME}?{" "}
              <Link
                href={`/register?next=${encodeURIComponent(next)}`}
                className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Create an account
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-white/50 mt-4">
          <Link href="/" className="hover:text-white/80 transition-colors">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-800 to-blue-950" />
      }
    >
      <LoginForm />
    </Suspense>
  );
}
