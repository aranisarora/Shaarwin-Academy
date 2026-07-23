"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { submitSignupRequest } from "./actions";

type Status = "pending" | "denied";

/**
 * The closed-membership gate a signed-in-but-unapproved client sees. One page,
 * three states driven by the profile:
 *   1. request form  — pending, no phone yet
 *   2. waiting       — pending, phone submitted (polls until the founder approves)
 *   3. denied        — neutral "couldn't verify" copy, no wording that tips off
 *                      competitors, just a way to reach us
 * Styled like the onboarding screens (centred max-w-md), not the marketing shell.
 */
export function PendingFlow({
  initialStatus,
  initialName,
  phone,
  whatsappNumber,
}: {
  initialStatus: Status;
  initialName: string;
  /** profiles.phone if the request was already submitted. */
  phone: string | null;
  whatsappNumber: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phoneInput, setPhoneInput] = useState("");
  const [submittedPhone, setSubmittedPhone] = useState(phone);
  // Show the form again on demand (e.g. "wrong number?") even after submitting.
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const waiting = initialStatus === "pending" && !!submittedPhone && !editing;

  // While waiting, poll the server: when the founder approves, the next
  // requireUser pass redirects this page into onboarding. Short-lived screen,
  // so a plain refresh loop beats a realtime subscription.
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(id);
  }, [waiting, router]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await submitSignupRequest(name, phoneInput);
      if (!r.ok) {
        setError(r.error ?? "Couldn't send your request.");
        return;
      }
      if (r.status === "approved") {
        // A founder pre-registration matched — straight into the app.
        router.replace("/app");
        return;
      }
      setSubmittedPhone(phoneInput);
      setEditing(false);
    });
  }

  if (initialStatus === "denied") {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-4xl">Thanks for your interest</h1>
        <p className="text-fg-2">
          We couldn&apos;t verify your request just now. If you think that&apos;s a mistake,
          send us a message and we&apos;ll take a look.
        </p>
        <a
          href={`https://wa.me/${whatsappNumber}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block"
        >
          <Button size="lg">Message us on WhatsApp</Button>
        </a>
      </div>
    );
  }

  if (waiting) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-4xl">Request sent</h1>
        <p className="text-fg-2">
          Thanks! We personally check every new family. We&apos;ll WhatsApp you at{" "}
          <span className="font-medium text-fg">{submittedPhone}</span> as soon as
          you&apos;re approved — this page will move on automatically.
        </p>
        <p className="flex items-center gap-2 text-sm text-fg-2">
          <Spinner /> Waiting for approval…
        </p>
        <button
          type="button"
          onClick={() => {
            setPhoneInput(submittedPhone ?? "");
            setEditing(true);
          }}
          className="text-sm text-ember underline-offset-4 hover:underline"
        >
          Wrong number?
        </button>
      </div>
    );
  }

  // Request form (pending, no phone yet — or re-editing the number).
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="font-display text-4xl">One quick step</h1>
        <p className="text-fg-2">
          The academy is invite-only — we verify every new member personally. Leave
          your name and WhatsApp number and we&apos;ll approve your access shortly.
        </p>
      </div>

      <Input
        label="Your name"
        autoComplete="name"
        placeholder="Priya Sharma"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        label="Phone (with country code)"
        type="tel"
        autoComplete="tel"
        placeholder="+91 98123 45678"
        value={phoneInput}
        onChange={(e) => setPhoneInput(e.target.value)}
      />

      {error && <p className="text-sm text-err">{error}</p>}

      <Button
        onClick={submit}
        disabled={pending || !name.trim() || !phoneInput.trim()}
        className="w-full"
        size="lg"
      >
        {pending ? <Spinner /> : "Request access"}
      </Button>
    </div>
  );
}
