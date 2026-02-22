"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getProfile, updateProfile } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BRAND_NAME } from "@/config/operating-hours";
import { Loader2 } from "lucide-react";
import Link from "next/link";

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard/bookings";

  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setIsAuthenticated(true);
        const profile = await getProfile();
        if (profile?.phone_number) {
          // Already fully set up — redirect immediately
          router.replace(next);
          return;
        }
      }

      setChecking(false);
    }
    checkAuth();
  }, [next, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setLoading(true);

    if (isAuthenticated) {
      // Already signed in but missing phone — just save it and redirect
      try {
        await updateProfile({ phone_number: phone.trim() });
        router.push(next);
      } catch {
        setLoading(false);
      }
      return;
    }

    // Not yet signed in — store phone and trigger Google OAuth
    localStorage.setItem("pendingPhone", phone.trim());

    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/50">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">{BRAND_NAME}</CardTitle>
          <CardDescription>
            {isAuthenticated
              ? "Add your phone number to complete your account"
              : "Create your account to book classes"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Step 1 — Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">Mobile Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                We use this to send booking confirmations and schedule updates.
              </p>
            </div>

            {/* Step 2 — Google sign-in (if not yet authenticated) */}
            {!isAuthenticated && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-medium text-center">
                  Then sign in with Google
                </p>
                <p className="text-xs text-muted-foreground text-center">
                  We use Google to verify your identity and keep your account
                  secure. No password needed.
                </p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !phone.trim()}
              className="w-full gap-2"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Please wait...
                </>
              ) : isAuthenticated ? (
                "Save & Continue"
              ) : (
                <>
                  <GoogleIcon />
                  Continue with Google
                </>
              )}
            </Button>

            {!isAuthenticated && (
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  href={`/login?next=${encodeURIComponent(next)}`}
                  className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
                >
                  Sign in
                </Link>
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-muted/50">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
