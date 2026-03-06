"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageCircle, CheckCircle2, CalendarDays } from "lucide-react";

interface PaymentStepProps {
  onConfirmed: (screenshot: File | null) => void;
  onBack?: () => void;
  /** Step number badge (e.g. 3). Omit to hide the badge. */
  stepNumber?: number;
  /** Total amount due in INR */
  totalAmount?: number;
  /** Pre-filled WhatsApp message for the founder */
  whatsappMessage?: string;
  /** Founder's WhatsApp number (digits only, e.g. 919876543210) */
  founderPhone?: string;
}

export function PaymentStep({
  onConfirmed,
  onBack,
  stepNumber,
  totalAmount,
  whatsappMessage = "",
  founderPhone = "",
}: PaymentStepProps) {
  const [whatsappOpened, setWhatsappOpened] = useState(false);

  const handleWhatsApp = () => {
    const url = `https://wa.me/${founderPhone}?text=${encodeURIComponent(whatsappMessage)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setWhatsappOpened(true);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        {stepNumber !== undefined && (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {stepNumber}
          </div>
        )}
        <h2 className="text-lg font-semibold">Payment</h2>
      </div>

      {totalAmount !== undefined && (
        <div className="rounded-lg bg-primary/10 border border-primary/20 px-4 py-3 text-center">
          <p className="text-sm text-muted-foreground">Amount to pay</p>
          <p className="text-2xl font-bold text-primary">
            ₹{totalAmount.toLocaleString("en-IN")}
          </p>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Message the founder on WhatsApp to complete your payment. Send the message below:
      </p>

      {/* Pre-filled message preview */}
      {whatsappMessage && (
        <div className="rounded-lg border-l-4 border-green-500 bg-green-50 dark:bg-green-950/20 px-4 py-3">
          <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1 uppercase tracking-wide">
            Your message
          </p>
          <p className="text-sm text-green-900 dark:text-green-200 leading-relaxed">
            {whatsappMessage}
          </p>
        </div>
      )}

      {/* WhatsApp CTA */}
      <Button
        onClick={handleWhatsApp}
        className="w-full bg-green-600 hover:bg-green-500 text-white gap-2"
        size="lg"
      >
        <MessageCircle className="h-5 w-5" />
        Chat with Founder on WhatsApp
      </Button>

      {/* Confirm after paying */}
      <Button
        onClick={() => onConfirmed(null)}
        disabled={!whatsappOpened}
        className="w-full gap-2"
        size="lg"
      >
        <CheckCircle2 className="h-5 w-5" />
        I&apos;ve Paid
      </Button>

      {!whatsappOpened && (
        <p className="text-xs text-center text-muted-foreground -mt-2">
          Chat with the founder first, then confirm here once you&apos;ve paid.
        </p>
      )}

      {/* Post-payment info */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-4 py-3 flex gap-3 items-start">
        <CalendarDays className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          After payment, you can <strong>reschedule sessions</strong> or <strong>mark yourself absent</strong> anytime from <strong>Manage Bookings</strong> in your account.
        </p>
      </div>

      {/* Coming Soon — direct payment */}
      <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-3 text-center opacity-60 select-none">
        <p className="text-sm text-muted-foreground font-medium">
          Pay directly on website — <span className="italic">Coming Soon</span>
        </p>
      </div>

      {/* Back button */}
      {onBack && (
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      )}
    </div>
  );
}
