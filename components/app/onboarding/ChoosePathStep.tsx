"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { finishOnboardingSetup } from "@/app/app/onboarding/actions";

/**
 * Onboarding final step: pick a path and go straight into booking. Choosing
 * stamps onboarded_at (the setup steps are done) so the real /app/book routes
 * stop bouncing back here.
 */
export function ChoosePathStep() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<"private" | "group" | null>(null);
  const [pending, startTransition] = useTransition();

  function go(path: "private" | "group") {
    setChoice(path);
    setError(null);
    startTransition(async () => {
      const r = await finishOnboardingSetup();
      if (!r.ok) {
        setChoice(null);
        return setError(r.error ?? "Something went wrong. Try again.");
      }
      router.push(path === "private" ? "/app/book/private?onboarding=1" : "/app/book?onboarding=1");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => go("private")}
        disabled={pending}
        className="w-full rounded-[12px] border border-line bg-surface-2 p-5 text-left transition-colors hover:border-ember disabled:opacity-60"
      >
        <div className="flex items-center justify-between">
          <p className="font-display text-xl">Book a private class</p>
          {pending && choice === "private" && <Spinner />}
        </div>
        <p className="mt-1 text-sm text-fg-2">
          A coach comes to you — your home or your local clubhouse. One-to-one,
          at your pace.
        </p>
      </button>

      <button
        onClick={() => go("group")}
        disabled={pending}
        className="w-full rounded-[12px] border border-line bg-surface-2 p-5 text-left transition-colors hover:border-ember disabled:opacity-60"
      >
        <div className="flex items-center justify-between">
          <p className="font-display text-xl">Join a group class</p>
          {pending && choice === "group" && <Spinner />}
        </div>
        <p className="mt-1 text-sm text-fg-2">
          Train with players at your level at a venue near you — your first
          group class is free.
        </p>
      </button>

      {error && <p className="text-sm text-err">{error}</p>}
    </div>
  );
}
