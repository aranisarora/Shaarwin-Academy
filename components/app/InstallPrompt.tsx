"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useIsIos, useIsStandalone, useLocalFlag } from "./use-pwa";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Contextual install prompt (P12): shown once, only after the first booking
 * (localStorage flag set by the app), never on first paint. iOS gets the
 * Share → Add to Home Screen instructions.
 */
export function InstallPrompt() {
  const isIos = useIsIos();
  const standalone = useIsStandalone();
  const installDone = useLocalFlag("sharwin_install_done");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("sharwin_install_done")) return;
    // Non-iOS: only surface after the user has made a booking (less intrusive),
    // and only once the browser fires beforeinstallprompt.
    const booked = localStorage.getItem("sharwin_has_booked") === "1";
    if (!booked) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // iOS shows the Share instructions; other browsers wait for beforeinstallprompt
  // (which only fires post-booking, gated above). Hidden once installed,
  // dismissed, or already running standalone.
  const show = !installDone && !dismissed && !standalone && (isIos || deferred !== null);
  if (!show) return null;

  return (
    <div className="pb-safe fixed inset-x-3 bottom-16 z-40 rounded-[12px] border border-line bg-surface-2 p-4 shadow-[var(--shadow-sheet)] lg:bottom-6 lg:left-auto lg:right-6 lg:w-96">
      <p className="font-medium">Add Sharwin to your home screen</p>
      <p className="mt-1 text-sm text-fg-2">
        {isIos
          ? "Tap Share, then “Add to Home Screen” — your schedule, one tap away."
          : "Your schedule, one tap away."}
      </p>
      <div className="mt-3 flex gap-2">
        {!isIos && deferred && (
          <Button
            onClick={async () => {
              await deferred.prompt();
              localStorage.setItem("sharwin_install_done", "1");
              setDismissed(true);
            }}
          >
            Install
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            localStorage.setItem("sharwin_install_done", "1");
            setDismissed(true);
          }}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
