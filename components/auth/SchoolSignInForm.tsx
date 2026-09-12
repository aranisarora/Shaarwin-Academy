"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { isSyntheticEmail } from "@/lib/synthetic-email";

/**
 * Sign-in for a school account: an email and a password, and nothing else.
 *
 * Everything about this form is shaped by how the credential arrives. It is
 * minted by the founder, sent once on WhatsApp, and shared by several people at
 * one campus — a sports head, a coordinator, whoever is covering. That rules out
 * the whole of the normal login screen: a six-digit code lands in one inbox and
 * cannot be shared, and the address here is not an inbox at all, so an emailed
 * code or a reset link would both be sent into the void.
 *
 * So: no code path, no Google, no "forgot password". The one honest recovery is
 * to ask us, and the page says so in as many words rather than offering a link
 * that would silently do nothing.
 *
 * `defaultEmail` comes off the `?email=` in the link they tapped (see
 * lib/school-handover.ts). It is prefilled and not locked — a school that has
 * been given a second campus, or has retyped the address itself, must still be
 * able to correct it.
 */
export function SchoolSignInForm({
  defaultEmail = "",
  next,
}: {
  defaultEmail?: string;
  /** Where to land after signing in. Defaults to the school app; a school that
   *  followed a deep link (the proxy sends `?next=`) resumes there instead. */
  next?: string;
}) {
  const supabase = createClient();

  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = next || "/school";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      // Trimmed because this is typed off a phone screen as often as it is
      // tapped through, and a keyboard that appends a space to a pasted address
      // would otherwise fail with "didn't match" and no way to see why.
      email: email.trim(),
      password: password.trim(),
    });
    setBusy(false);
    if (error) {
      return setError(
        "That email and password didn't match. Check them against the message we sent — and mind any spaces at the ends."
      );
    }
    // Hard navigate rather than router.push: the server needs the fresh auth
    // cookie, and an RSC fetch fires before the cookie is committed. If this
    // account is not a school the proxy corrects the destination on arrival.
    window.location.replace(target);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input
        label="Email"
        type="email"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint={
          isSyntheticEmail(email)
            ? "This is your school's username. Nothing is ever sent to it."
            : undefined
        }
        required
      />
      <div className="flex flex-col gap-1.5">
        <Input
          label="Password"
          type={revealed ? "text" : "password"}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          // Focus what they still have to do. When the link filled the email in,
          // the only remaining act is this field; when it didn't, the email is
          // empty and stealing focus past it would be wrong.
          autoFocus={Boolean(defaultEmail)}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error ?? undefined}
          required
        />
        {/* Three hyphenated words and four digits, read off a WhatsApp message
            on the same phone. Dots are a guarantee of a second attempt. */}
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="self-start text-sm text-fg-2 underline-offset-4 hover:underline"
        >
          {revealed ? "Hide password" : "Show password"}
        </button>
      </div>
      <Button type="submit" disabled={busy || !email || !password}>
        {busy ? <Spinner /> : "Log in"}
      </Button>
    </form>
  );
}
