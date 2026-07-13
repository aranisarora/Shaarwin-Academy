"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

/**
 * One-screen auth: email OTP + Google OAuth.
 * `mode` only changes copy — Supabase OTP signs up on first use.
 * Booking intent survives auth via ?next= and sessionStorage.
 */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const params = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next =
    params.get("next") ??
    (typeof window !== "undefined"
      ? sessionStorage.getItem("auth_next")
      : null) ??
    "/app";
  const plan = params.get("plan");
  const target = plan ? `/app/membership?plan=${plan}` : next;

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    sessionStorage.setItem("auth_next", target);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: mode === "signup" && name ? { full_name: name } : undefined,
      },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    setBusy(false);
    if (error) return setError("That code didn't match. Check and try again.");
    sessionStorage.removeItem("auth_next");
    // Hard navigate so the browser sends the fresh auth cookie in the server
    // request — router.push fires an RSC fetch before the cookie is committed.
    window.location.replace(target);
  }

  async function google() {
    sessionStorage.setItem("auth_next", target);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`,
      },
    });
  }

  if (step === "code") {
    return (
      <form onSubmit={verify} className="flex flex-col gap-4">
        <p className="text-fg-2">
          We sent a six-digit code to <span className="text-fg">{email}</span>.
        </p>
        <Input
          label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={error ?? undefined}
          required
        />
        <Button type="submit" disabled={busy || code.length < 6}>
          {busy ? <Spinner /> : "Continue"}
        </Button>
        <button
          type="button"
          onClick={() => setStep("email")}
          className="text-sm text-fg-2 underline-offset-4 hover:underline"
        >
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={sendCode} className="flex flex-col gap-4">
        {mode === "signup" && (
          <Input
            label="Your name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error ?? undefined}
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner /> : mode === "signup" ? "Create account" : "Send code"}
        </Button>
      </form>
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-fg-2">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button variant="ghost" onClick={google}>
        Continue with Google
      </Button>
    </div>
  );
}
