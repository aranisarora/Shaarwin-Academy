"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createGroupBooking, createPrivateBooking } from "@/actions/bookings";
import { getProfile, updateProfile } from "@/actions/auth";
import { PhoneCollectForm } from "@/components/booking/phone-collect-form";
import { PaymentStep } from "@/components/booking/payment-step";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PRICING } from "@/config/pricing";
import type {
  PendingBooking,
  GroupBookingPayload,
  PrivateBookingPayload,
} from "@/components/booking/booking-checkout";
import type { Profile } from "@/types/database";

type Stage = "loading" | "needs-phone" | "payment" | "processing";

function computeTotal(pending: PendingBooking): number {
  if (pending.type === "group") {
    const payload = pending.data as GroupBookingPayload;
    return payload.batchIds.length * PRICING.groupBatchPrice;
  } else {
    const payload = pending.data as PrivateBookingPayload;
    return payload.slots.length * PRICING.privateSlotPrice;
  }
}

function buildWhatsappMessage(pending: PendingBooking): string {
  const total = computeTotal(pending);
  if (pending.type === "group") {
    const payload = pending.data as GroupBookingPayload;
    return `Hi, I want to book a group class — ${payload.batchIds.length} batch(es), ₹${total.toLocaleString("en-IN")}`;
  } else {
    const payload = pending.data as PrivateBookingPayload;
    return `Hi, I want to book a private session — ${payload.slots.length} slot(s), ₹${total.toLocaleString("en-IN")}`;
  }
}

export default function BookingCompletePage() {
  const router = useRouter();
  const initializedRef = useRef(false);
  const [stage, setStage] = useState<Stage>("loading");
  const [pendingData, setPendingData] = useState<PendingBooking | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const raw = localStorage.getItem("pendingBooking");
    if (!raw) {
      router.replace("/dashboard/bookings");
      return;
    }

    async function initialize() {
      try {
        const pending: PendingBooking = JSON.parse(raw!);
        let userProfile = await getProfile();

        if (!userProfile) {
          router.replace("/register?next=/book/complete");
          return;
        }

        // Apply phone saved during registration if profile is missing it
        const pendingPhone = localStorage.getItem("pendingPhone");
        if (pendingPhone && !userProfile.phone_number) {
          try {
            await updateProfile({ phone_number: pendingPhone });
            userProfile = { ...userProfile, phone_number: pendingPhone };
          } catch {
            // Non-fatal
          } finally {
            localStorage.removeItem("pendingPhone");
          }
        }

        setPendingData(pending);
        setProfile(userProfile);

        // Legacy format: pending data already includes name/phone
        const data = pending.data as GroupBookingPayload & PrivateBookingPayload;
        if (data.userName && data.phoneNumber) {
          setStage("processing");
          await processBooking(pending, data.userName, data.phoneNumber);
          return;
        }

        if (!userProfile.phone_number) {
          setStage("needs-phone");
          return;
        }

        setStage("payment");
      } catch {
        localStorage.removeItem("pendingBooking");
        toast.error("Something went wrong. Please try booking again.");
        router.replace("/book");
      }
    }

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function processBooking(
    pending: PendingBooking,
    userName: string,
    phoneNumber: string
  ) {
    setStage("processing");
    try {
      if (pending.type === "group") {
        const payload = pending.data as GroupBookingPayload;
        await createGroupBooking({
          batchIds: payload.batchIds,
          userName,
          phoneNumber,
        });
      } else {
        const payload = pending.data as PrivateBookingPayload;
        await createPrivateBooking({ ...payload, userName, phoneNumber });
      }

      localStorage.removeItem("pendingBooking");
      toast.success("Booking confirmed! Check your Google Calendar.");
      router.replace("/dashboard/bookings");
    } catch (error) {
      localStorage.removeItem("pendingBooking");
      toast.error(
        error instanceof Error ? error.message : "Booking failed. Please try again."
      );
      router.replace("/book");
    }
  }

  const handlePaymentConfirmed = async (_screenshot: File | null) => {
    if (!pendingData || !profile) return;
    processBooking(pendingData, profile.full_name || "", profile.phone_number || "");
  };

  const handlePhoneComplete = async (phone: string) => {
    if (!pendingData) return;
    setPhoneLoading(true);
    try {
      await updateProfile({ phone_number: phone });
      const updated = { ...profile!, phone_number: phone };
      setProfile(updated);
      setStage("payment");
    } catch {
      toast.error("Failed to save phone number. Please try again.");
    } finally {
      setPhoneLoading(false);
    }
  };

  // ── Loading ──
  if (stage === "loading") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-lg font-medium">Preparing your booking…</p>
      </div>
    );
  }

  // ── Needs phone ──
  if (stage === "needs-phone") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <div className="w-full max-w-md space-y-3">
          <PhoneCollectForm
            onComplete={handlePhoneComplete}
            loading={phoneLoading}
          />
          <div className="text-center">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setStage("payment")}
            >
              Skip for now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Payment ──
  if (stage === "payment") {
    const total = pendingData ? computeTotal(pendingData) : undefined;
    const whatsappMessage = pendingData ? buildWhatsappMessage(pendingData) : "";
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4">
          <div>
            <h1 className="text-2xl font-bold">Complete Your Booking</h1>
            <p className="mt-1 text-muted-foreground">
              Message the founder on WhatsApp to confirm your payment and booking.
            </p>
          </div>
          <Card>
            <CardContent className="p-6">
              <PaymentStep
                onBack={() => router.push("/book")}
                onConfirmed={handlePaymentConfirmed}
                totalAmount={total}
                whatsappMessage={whatsappMessage}
                founderPhone={process.env.NEXT_PUBLIC_FOUNDER_WHATSAPP ?? ""}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Processing ──
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-lg font-medium">Confirming your booking…</p>
      <p className="text-sm text-muted-foreground">
        Please wait while we set up your classes.
      </p>
    </div>
  );
}
