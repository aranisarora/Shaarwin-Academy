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

        {result?.ok && !result.waLink ? (
          // Fallback: no WhatsApp number configured, so the user has to send
          // the link message manually — the only case where we surface the code.
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Message the academy WhatsApp number within {result.expiresMinutes}{" "}
              minutes with:
            </p>
            <p className="text-fg">Link my account: {result.code}</p>
          </div>
        ) : (
          <>
            {result && !result.ok && (
              <p className="text-sm text-err">{result.error}</p>
            )}
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await generateWhatsAppLinkCode();
                  setResult(res);
                  if (res.ok && res.waLink) {
                    window.open(res.waLink, "_blank");
                  }
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
