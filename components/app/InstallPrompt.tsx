"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

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
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("sharwin_install_done")) return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari only
      window.navigator.standalone === true;
    if (standalone) return;

    const ua = navigator.userAgent;
    const iosViaUA = /iphone|ipad|ipod/i.test(ua);
    const iosViaTouch =
      /Mac/.test(navigator.platform ?? "") && navigator.maxTouchPoints > 1;
    const ios = iosViaUA || iosViaTouch;
    setIsIos(ios);
    if (ios) {
      setShow(true);
      return;
    }

    // Non-iOS: only show after the user has made a booking (less intrusive).
    const booked = localStorage.getItem("sharwin_has_booked") === "1";
    if (!booked) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

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
              setShow(false);
            }}
          >
            Install
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            localStorage.setItem("sharwin_install_done", "1");
            setShow(false);
          }}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
