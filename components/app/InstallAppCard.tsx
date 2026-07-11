"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Install app" card for the settings / more / profile screens. Unlike the
 * contextual InstallPrompt, this is always available so a user can install the
 * PWA on demand. Hides itself when already running standalone. Android/desktop
 * get a one-tap Install button (via beforeinstallprompt); iOS gets the
 * Share → Add to Home Screen instructions.
 */
export function InstallAppCard() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari only
      window.navigator.standalone === true;
    setStandalone(isStandalone);
    // navigator.userAgent is unreliable on modern iOS (Apple masks it).
    // maxTouchPoints > 1 on a Mac platform is the standard iOS-on-iPad fallback.
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

  // Already installed / running as an app — nothing to offer.
  if (standalone || installed) return null;

  return (
    <Card>
      <Card.Content className="space-y-4">
        <div>
          <p className="label">Install app</p>
          <p className="mt-1 text-sm text-muted">
            {isIos
              ? "Add Sharwin to your home screen: tap Share, then “Add to Home Screen” — your schedule, one tap away."
              : "Add Sharwin to your home screen for faster access — your schedule, one tap away."}
          </p>
        </div>

        {!isIos && (
          <Button
            variant="primary"
            disabled={!deferred}
            onClick={async () => {
              if (!deferred) return;
              await deferred.prompt();
              const choice = await deferred.userChoice;
              if (choice.outcome === "accepted") setInstalled(true);
              setDeferred(null);
            }}
          >
            {deferred ? "Install app" : "Not available on this browser"}
          </Button>
        )}
      </Card.Content>
    </Card>
  );
}
