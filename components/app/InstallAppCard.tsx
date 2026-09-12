"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useIsIos, useIsStandalone } from "./use-pwa";

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
  const isIos = useIsIos();
  const standalone = useIsStandalone();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
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
