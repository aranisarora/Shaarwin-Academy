"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, Upload } from "lucide-react";

interface PaymentStepProps {
  onConfirmed: () => void;
  onBack?: () => void;
  /** Step number badge (e.g. 3). Omit to hide the badge. */
  stepNumber?: number;
}

export function PaymentStep({
  onConfirmed,
  onBack,
  stepNumber,
}: PaymentStepProps) {
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      <p className="text-sm text-muted-foreground">
        Scan the QR code below with Google Pay to complete your payment, then
        upload a screenshot of the payment confirmation to proceed.
      </p>

      {/* QR Code */}
      <div className="flex justify-center">
        <div className="rounded-xl border bg-white p-3 shadow-sm">
          <Image
            src="/images/gpay-qr.jepg"
            alt="Google Pay QR Code"
            width={200}
            height={200}
            className="block"
          />
        </div>
      </div>

      {/* Screenshot upload */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Upload payment screenshot</p>
        <div
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
            screenshot
              ? "border-green-500 bg-green-50 dark:bg-green-950/20"
              : "border-muted-foreground/30 hover:border-muted-foreground/60"
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          {screenshot ? (
            <>
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                {screenshot.name}
              </p>
              <p className="text-xs text-muted-foreground">Click to change</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Click to upload screenshot
              </p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {onBack && (
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        <Button
          onClick={onConfirmed}
          disabled={!screenshot}
          className="flex-1"
        >
          Confirm Payment &amp; Continue
        </Button>
      </div>
    </div>
  );
}
