"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Get the app" finale of onboarding. Android/desktop get a one-tap Install
 * (beforeinstallprompt); iOS gets the Share → Add to Home Screen steps.
 * "Done" never gates on the actual install — it's undetectable on iOS.
 */
export function InstallStep() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // This screen is the install moment — suppress the contextual post-booking
    // InstallPrompt so the user isn't asked twice.
    localStorage.setItem("sharwin_install_done", "1");

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari only
      window.navigator.standalone === true;
    setStandalone(isStandalone);
    const ua = navigator.userAgent;
    const iosViaUA = /iphone|ipad|ipod/i.test(ua);
    const iosViaTouch =
      /Mac/.test(navigator.platform ?? "") && navigator.maxTouchPoints > 1;
    setIsIos(iosViaUA || iosViaTouch);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const done = standalone || installed;

  return (
    <div className="space-y-6 text-center">
      <span aria-hidden className="ball-drop mx-auto block h-5 w-5 rounded-full bg-ember" />
      <div>
        <h1 className="font-display text-4xl">You&apos;re all set.</h1>
        <p className="mt-2 text-fg-2">
          {done
            ? "Your booking is in and the app is on your home screen."
            : "One last thing — put Sharwin on your home screen so your schedule is a tap away."}
        </p>
      </div>

      {!done &&
        (isIos ? (
          <ol className="mx-auto max-w-xs space-y-2 rounded-[12px] border border-line bg-surface-2 p-5 text-left text-sm">
            <li>
              1. Tap the <span className="font-semibold">Share</span> button in Safari
            </li>
            <li>
              2. Choose <span className="font-semibold">&ldquo;Add to Home Screen&rdquo;</span>
            </li>
            <li>3. Tap <span className="font-semibold">Add</span> — that&apos;s it</li>
          </ol>
        ) : (
          <Button
            variant="primary"
            disabled={!deferred}
            className="w-full"
            onClick={async () => {
              if (!deferred) return;
              await deferred.prompt();
              const choice = await deferred.userChoice;
              if (choice.outcome === "accepted") setInstalled(true);
              setDeferred(null);
            }}
          >
            {deferred ? "Install the app" : "Install isn't available on this browser"}
          </Button>
        ))}

      <Link
        href="/app"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border border-line px-6 font-semibold hover:border-ember"
      >
        Done — take me home
      </Link>
    </div>
  );
}
