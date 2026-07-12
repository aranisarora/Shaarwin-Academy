"use client";

import { useState } from "react";
import { PlayersStep, type ExistingPlayer } from "@/components/app/onboarding/PlayersStep";
import { PhoneStep } from "@/components/app/onboarding/PhoneStep";
import { NotificationsStep } from "@/components/app/onboarding/NotificationsStep";
import { ChoosePathStep } from "@/components/app/onboarding/ChoosePathStep";

const STEPS = [
  {
    title: "Who's playing?",
    blurb:
      "Tell us who'll be at the table — you can add or change players any time from your profile.",
  },
  {
    title: "Your phone number",
    blurb:
      "For class updates — and if the academy pre-registered you, it unlocks your plan.",
  },
  {
    title: "Stay in the loop",
    blurb: "Choose which nudges you want — reminders, coach changes, openings.",
  },
  {
    title: "Book your first class",
    blurb: "Private at home, or a group class near you — your call.",
  },
] as const;

/**
 * Guided first-run setup. Server-side onboarding_step (0–3) decides where a
 * returning user resumes; each step's server action bumps it, so a refresh
 * mid-flow lands on the right screen. The final choice routes into the real
 * booking flow and stamps onboarded_at.
 */
export function OnboardingFlow({
  profileName,
  existing,
  initialStep,
  linkedPhone,
  initialPrefs,
}: {
  profileName: string;
  existing: ExistingPlayer[];
  initialStep: number;
  /** profiles.phone if already set (e.g. WhatsApp-provisioned accounts). */
  linkedPhone: string | null;
  initialPrefs: Record<string, boolean>;
}) {
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), 3));
  const current = STEPS[step];

  return (
    <div>
      <div className="mb-6 flex items-center gap-2" aria-hidden>
        {STEPS.map((_, n) => (
          <span
            key={n}
            className={`h-1.5 flex-1 rounded-full ${step >= n ? "bg-ember" : "bg-line"}`}
          />
        ))}
      </div>

      <h1 className="font-display mb-2 text-4xl">{current.title}</h1>
      <p className="mb-8 text-fg-2">{current.blurb}</p>

      {step === 0 && (
        <PlayersStep
          profileName={profileName}
          existing={existing}
          onDone={() => setStep(1)}
        />
      )}
      {step === 1 && <PhoneStep initialPhone={linkedPhone} onDone={() => setStep(2)} />}
      {step === 2 && (
        <NotificationsStep initialPrefs={initialPrefs} onDone={() => setStep(3)} />
      )}
      {step === 3 && <ChoosePathStep />}
    </div>
  );
}
