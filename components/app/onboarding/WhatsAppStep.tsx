"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import {
  generateWhatsAppLinkCode,
  type LinkCodeResult,
} from "@/lib/whatsapp/link-action";
import { checkWhatsAppLinked, confirmPhone } from "@/app/app/onboarding/actions";

const POLL_MS = 3000;

/**
 * Onboarding step 2: connect the WhatsApp assistant. After Connect is tapped
 * the step polls the server until the link lands (the bot redeems the code out
 * of band, so there's nothing to await client-side). "I can't use WhatsApp"
 * falls back to confirming a phone number — the bot auto-links a matching
 * profiles.phone the first time that number messages it.
 */
export function WhatsAppStep({
  linkedPhone,
  onDone,
}: {
  linkedPhone: string | null;
  onDone: () => void;
}) {
  const [phone, setPhone] = useState(linkedPhone);
  const [result, setResult] = useState<LinkCodeResult | null>(null);
  const [polling, setPolling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackPhone, setFallbackPhone] = useState("");
  const [fallbackDone, setFallbackDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const connected = Boolean(phone) || fallbackDone;

  async function refresh() {
    setChecking(true);
    try {
      const { phone: linked } = await checkWhatsAppLinked();
      if (linked) {
        setPhone(linked);
        setPolling(false);
      }
    } finally {
      setChecking(false);
    }
  }

  // Poll while waiting for the bot-side redemption; stop once linked or when
  // the tab is hidden (the visibilitychange handler restarts it).
  useEffect(() => {
    if (!polling || phone) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    pollTimer.current = setInterval(tick, POLL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [polling, phone]);

  function connect() {
    setError(null);
    startTransition(async () => {
      const res = await generateWhatsAppLinkCode();
      setResult(res);
      if (res.ok) {
        setPolling(true);
        if (res.waLink) window.open(res.waLink, "_blank");
      }
    });
  }

  function submitFallback() {
    setError(null);
    startTransition(async () => {
      const r = await confirmPhone(fallbackPhone);
      if (r.ok) setFallbackDone(true);
      else setError(r.error ?? "Couldn't save the number.");
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[12px] border border-line bg-surface-2 p-5">
        <p className="font-medium">Meet your WhatsApp assistant</p>
        <p className="mt-2 text-sm text-fg-2">
          Everything the app does, in a chat: book or reschedule classes, check
          the week&apos;s schedule, ask about plans — just message in plain
          English and it handles the rest.
        </p>
      </div>

      {connected ? (
        <div className="flex items-center gap-3 rounded-[12px] border border-ok bg-surface-2 p-4">
          <Badge tone="ok">Connected</Badge>
          <p className="text-sm">
            {phone
              ? `WhatsApp linked to ${phone}.`
              : "Number saved — message the academy WhatsApp any time and it'll know you."}
          </p>
        </div>
      ) : (
        <>
          <Button variant="primary" disabled={pending} onClick={connect} className="w-full">
            {pending ? <Spinner /> : polling ? "Open WhatsApp again" : "Connect WhatsApp"}
          </Button>

          {result?.ok && !result.waLink && (
            <div className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm">
              <p className="text-fg-2">
                Message the academy WhatsApp number within {result.expiresMinutes} minutes with:
              </p>
              <p className="mt-1 font-medium">Link my account: {result.code}</p>
            </div>
          )}
          {result && !result.ok && <p className="text-sm text-err">{result.error}</p>}

          {polling && (
            <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-4">
              <p className="text-sm text-fg-2">
                Once you&apos;ve sent the message on WhatsApp, come back here to continue setup.
              </p>
              <div className="flex items-center justify-between">
                <p className="text-sm text-fg-2">Waiting for your message to arrive…</p>
                <Button variant="ghost" onClick={refresh} disabled={checking}>
                  {checking ? <Spinner /> : "Refresh"}
                </Button>
              </div>
            </div>
          )}

          {fallbackOpen ? (
            <div className="space-y-3 rounded-[12px] border border-line p-4">
              <p className="text-sm text-fg-2">
                No problem — confirm your number and the assistant will
                recognise you whenever you message from it.
              </p>
              <Input
                label="Phone (with country code)"
                type="tel"
                placeholder="+91 98123 45678"
                value={fallbackPhone}
                onChange={(e) => setFallbackPhone(e.target.value)}
              />
              <Button
                onClick={submitFallback}
                disabled={pending || !fallbackPhone.trim()}
                className="w-full"
              >
                {pending ? <Spinner /> : "Confirm number"}
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setFallbackOpen(true)}
              className="text-sm text-fg-2 underline-offset-4 hover:underline"
            >
              I can&apos;t use WhatsApp on this device
            </button>
          )}
          {error && <p className="text-sm text-err">{error}</p>}
        </>
      )}

      <Button onClick={onDone} disabled={!connected} className="w-full" size="lg">
        Next
      </Button>
    </div>
  );
}
