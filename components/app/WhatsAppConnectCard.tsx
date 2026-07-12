"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import {
  generateWhatsAppLinkCode,
  getWhatsAppLinkedPhone,
  unlinkWhatsApp,
  type LinkCodeResult,
} from "@/lib/whatsapp/link-action";

const POLL_MS = 4000;

/** Interactive half of the WhatsApp card. When a phone is already linked it
 *  shows the connected number with an Unlink action instead of Connect. After
 *  Connect is tapped it polls until the bot-side redemption lands, with a
 *  manual Refresh for impatient thumbs. */
export function WhatsAppConnectCard({
  linkedPhone,
}: {
  linkedPhone: string | null;
}) {
  const [phone, setPhone] = useState(linkedPhone);
  const [result, setResult] = useState<LinkCodeResult | null>(null);
  const [unlinkError, setUnlinkError] = useState(false);
  const [polling, setPolling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    setChecking(true);
    try {
      const linked = await getWhatsAppLinkedPhone();
      if (linked) {
        setPhone(linked);
        setResult(null);
        setPolling(false);
      }
    } finally {
      setChecking(false);
    }
  }

  // Poll while a link is pending; the connected status updates by itself the
  // moment the WhatsApp message is redeemed.
  useEffect(() => {
    if (!polling || phone) return;
    timer.current = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [polling, phone]);

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
        ) : (
          <>
            {result?.ok && !result.waLink && (
              // Fallback: no WhatsApp number configured, so the user has to send
              // the link message manually — the only case where we surface the code.
              <div className="space-y-1">
                <p className="text-sm text-muted">
                  Message the academy WhatsApp number within {result.expiresMinutes}{" "}
                  minutes with:
                </p>
                <p className="text-fg">Link my account: {result.code}</p>
              </div>
            )}
            {result && !result.ok && (
              <p className="text-sm text-err">{result.error}</p>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await generateWhatsAppLinkCode();
                    setResult(res);
                    if (res.ok) {
                      setPolling(true);
                      if (res.waLink) window.open(res.waLink, "_blank");
                    }
                  })
                }
              >
                {pending ? <Spinner /> : polling ? "Open WhatsApp again" : "Connect WhatsApp"}
              </Button>
              {polling && (
                <Button variant="ghost" disabled={checking} onClick={refresh}>
                  {checking ? <Spinner /> : "Refresh"}
                </Button>
              )}
            </div>
            {polling && (
              <p className="text-xs text-fg-2">
                Waiting for your WhatsApp message — this updates by itself once
                it arrives.
              </p>
            )}
          </>
        )}
      </Card.Content>
    </Card>
  );
}
