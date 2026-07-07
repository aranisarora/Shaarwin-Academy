"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import {
  generateWhatsAppLinkCode,
  type LinkCodeResult,
} from "@/lib/whatsapp/link-action";

/** "Connect WhatsApp" card — shown on every role's profile/settings screen. */
export function WhatsAppConnect() {
  const [result, setResult] = useState<LinkCodeResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <Card.Content className="space-y-4">
        <div>
          <p className="label">WhatsApp assistant</p>
          <p className="mt-1 text-sm text-muted">
            Do everything from WhatsApp — book, cancel, reschedule, check your
            schedule — just by chatting in plain English.
          </p>
        </div>

        {result?.ok ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Send this code to the academy WhatsApp number within{" "}
              {result.expiresMinutes} minutes:
            </p>
            <p className="text-2xl font-black tracking-[0.2em] text-ember">
              {result.code}
            </p>
            {result.waLink ? (
              <Button
                onClick={() => window.open(result.waLink!, "_blank")}
                variant="primary"
              >
                Open WhatsApp
              </Button>
            ) : (
              <p className="text-sm text-muted">
                Message the academy WhatsApp number with:{" "}
                <span className="text-fg">Link my account: {result.code}</span>
              </p>
            )}
          </div>
        ) : (
          <>
            {result && !result.ok && (
              <p className="text-sm text-err">{result.error}</p>
            )}
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setResult(await generateWhatsAppLinkCode());
                })
              }
            >
              {pending ? <Spinner /> : "Connect WhatsApp"}
            </Button>
          </>
        )}
      </Card.Content>
    </Card>
  );
}
