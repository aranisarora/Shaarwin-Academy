"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PhoneField } from "@/components/app/PhoneField";
import { Spinner } from "@/components/ui/Spinner";
import { acknowledgePhoneStep, confirmPhone, type ConfirmPhoneResult } from "@/app/app/onboarding/actions";

/**
 * Onboarding step 2: confirm a phone number. Saving it is what claims a
 * pre-registration invite (the profiles.phone trigger grants the gifted plan),
 * so this step never leaves the app — WhatsApp linking happens after the
 * first booking instead. Pre-registered clients get told their plan unlocked.
 */
export function PhoneStep({
  initialPhone,
  onDone,
}: {
  initialPhone: string | null;
  onDone: () => void;
}) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [saved, setSaved] = useState<ConfirmPhoneResult | null>(
    initialPhone ? { ok: true } : null
  );
  // True when the phone was pre-loaded; clicking "Next" must still bump the DB step.
  const [preLoaded] = useState(!!initialPhone);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmed = Boolean(saved?.ok);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await confirmPhone(phone);
      if (r.ok) setSaved(r);
      else setError(r.error ?? "Couldn't save the number.");
    });
  }

  function next() {
    if (preLoaded && !saved?.preRegistered) {
      // Phone was already in the profile — confirmPhone was never called,
      // so onboarding_step wasn't bumped. Do it now before advancing.
      startTransition(async () => {
        await acknowledgePhoneStep();
        onDone();
      });
    } else {
      onDone();
    }
  }

  return (
    <div className="space-y-5">
      <PhoneField
        value={phone}
        onChange={(v) => {
          setPhone(v);
          setSaved(null);
        }}
      />

      {confirmed && saved?.preRegistered ? (
        <div className="space-y-2 rounded-[12px] border border-ok bg-surface-2 p-4">
          <Badge tone="ok">Pre-registered</Badge>
          <p className="text-sm">
            Welcome back — the academy pre-registered this number
            {saved.planName ? (
              <>
                , so your <span className="font-medium">{saved.planName}</span>{" "}
                plan is already active
              </>
            ) : (
              " and your account details are set up"
            )}
            . You can book right away.
          </p>
        </div>
      ) : confirmed ? (
        <div className="flex items-center gap-3 rounded-[12px] border border-ok bg-surface-2 p-4">
          <Badge tone="ok">Saved</Badge>
          <p className="text-sm">Number confirmed — we&apos;ll use it for class updates.</p>
        </div>
      ) : null}

      {error && <p className="text-sm text-err">{error}</p>}

      {confirmed ? (
        <Button onClick={next} disabled={pending} className="w-full" size="lg">
          {pending ? <Spinner /> : "Next"}
        </Button>
      ) : (
        <Button
          onClick={submit}
          disabled={pending || !phone.trim()}
          className="w-full"
          size="lg"
        >
          {pending ? <Spinner /> : "Confirm number"}
        </Button>
      )}
    </div>
  );
}
