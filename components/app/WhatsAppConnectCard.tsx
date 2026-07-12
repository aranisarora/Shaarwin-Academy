"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import {
  generateWhatsAppLinkCode,
  unlinkWhatsApp,
  type LinkCodeResult,
} from "@/lib/whatsapp/link-action";

/** Interactive half of the WhatsApp card. When a phone is already linked it
 *  shows the connected number with an Unlink action instead of Connect. */
export function WhatsAppConnectCard({
  linkedPhone,
}: {
  linkedPhone: string | null;
}) {
  const [phone, setPhone] = useState(linkedPhone);
  const [result, setResult] = useState<LinkCodeResult | null>(null);
  const [unlinkError, setUnlinkError] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Card>
      <Card.Content className="space-y-4">
        <div>
          <p className="label">WhatsApp assistant</p>
          <p className="mt-1 text-sm text-muted">
            {phone
              ? `Connected to ${phone}. Book, cancel, reschedule or check your schedule just by chatting in plain English.`
              : "Do everything from WhatsApp — book, cancel, reschedule, check your schedule — just by chatting in plain English."}
          </p>
        </div>

        {phone ? (
          <>
            {unlinkError && (
              <p className="text-sm text-err">
                Couldn&apos;t unlink — try again.
              </p>
            )}
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setUnlinkError(false);
                  const res = await unlinkWhatsApp();
                  if (res.ok) {
                    setPhone(null);
                    setResult(null);
                  } else {
                    setUnlinkError(true);
                  }
                })
              }
            >
              {pending ? <Spinner /> : "Unlink WhatsApp"}
            </Button>
          </>
        ) : result?.ok && !result.waLink ? (
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
            <div className="flex gap-2">
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
              {result?.ok && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    startTransition(() => {
                      router.refresh();
                    });
                  }}
                >
                  {pending ? <Spinner /> : "Check status"}
                </Button>
              )}
            </div>
          </>
        )}
      </Card.Content>
    </Card>
  );
}
