"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { isSyntheticEmail } from "@/lib/synthetic-email";

/**
 * The way in for a family: email OTP plus Google, and nothing to choose between
 * them beyond which one they trust. `mode` only changes copy — Supabase OTP
 * signs up on first use. Booking intent survives auth via ?next= and
 * sessionStorage.
 *
 * The password path used to live here as a third step behind a small link under
 * the Google button. It has moved to `/login/school`, which is where the link we
 * send a school now points. Two reasons it is better off there. It was the least
 * prominent control on the page and the only way into a school account, which is
 * exactly backwards for an audience that has never seen the app. And a school
 * screen can say the true thing about a shared, un-emailed credential — no code,
 * no reset link, ask us — which a form serving both audiences at once cannot.
 */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const params = useSearchParams();
  const router = useRouter();
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
    const typed = email.trim();

    // A school address gets sent to the school screen instead of a code.
    //
    // These addresses are minted, have no inbox and are never delivered to, so
    // `signInWithOtp` here would succeed, send a code into nothing, and leave a
    // head teacher staring at "we sent you a six-digit code" until they give up
    // and ring the founder. That is the exact failure the old layout invited:
    // the school's own way in was a footnote and this form was the obvious one.
    // Carrying the address across means the rescue costs them no typing.
    if (typed && isSyntheticEmail(typed)) {
      router.push(`/login/school?email=${encodeURIComponent(typed)}`);
      return;
    }

    setBusy(true);
    setError(null);
    sessionStorage.setItem("auth_next", target);
    const { error } = await supabase.auth.signInWithOtp({
      email: typed,
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
      email: email.trim(),
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
