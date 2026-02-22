"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createGroupBooking, createPrivateBooking } from "@/actions/bookings";
import { getProfile, updateProfile } from "@/actions/auth";
import { PhoneCollectForm } from "@/components/booking/phone-collect-form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type {
  PendingBooking,
  GroupBookingPayload,
  PrivateBookingPayload,
} from "@/components/booking/booking-checkout";
import type { Profile } from "@/types/database";

export default function BookingCompletePage() {
  const router = useRouter();
  const processedRef = useRef(false);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [pendingData, setPendingData] = useState<PendingBooking | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    const raw = localStorage.getItem("pendingBooking");
    if (!raw) {
      router.push("/dashboard/bookings");
      return;
    }

    async function checkProfileAndProcess() {
      try {
        const pending: PendingBooking = JSON.parse(raw!);
        const userProfile = await getProfile();
        setProfile(userProfile);
        setPendingData(pending);

        // If pending data already has userName/phoneNumber (old format), use those directly
        const data = pending.data;
        if (data.userName && data.phoneNumber) {
          await processBooking(pending, data.userName, data.phoneNumber);
          return;
        }

        // New format: resolve from profile
        if (!userProfile?.phone_number) {
          setNeedsPhone(true);
          return;
        }

        // Profile is complete, process immediately
        await processBooking(
          pending,
          userProfile.full_name || "",
          userProfile.phone_number
        );
      } catch (error) {
        localStorage.removeItem("pendingBooking");
        toast.error(
          error instanceof Error
            ? error.message
            : "Booking failed. Please try again."
        );
        router.push("/book");
      }
    }

    checkProfileAndProcess();
  }, [router]);

  async function processBooking(
    pending: PendingBooking,
    userName: string,
    phoneNumber: string
  ) {
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
        await createPrivateBooking({
          ...payload,
          userName,
          phoneNumber,
        });
      }

      localStorage.removeItem("pendingBooking");
      toast.success("Booking confirmed! Check your Google Calendar.");
      router.push("/dashboard/bookings");
    } catch (error) {
      localStorage.removeItem("pendingBooking");
      toast.error(
        error instanceof Error
          ? error.message
          : "Booking failed. Please try again."
      );
      router.push("/book");
    }
  }

  const handlePhoneComplete = async (phone: string) => {
    if (!pendingData || !profile) return;
    setPhoneLoading(true);

    try {
      await updateProfile({ phone_number: phone });
      await processBooking(
        pendingData,
        profile.full_name || "",
        phone
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save phone number"
      );
      setPhoneLoading(false);
    }
  };

  if (needsPhone) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <PhoneCollectForm
          onComplete={handlePhoneComplete}
          loading={phoneLoading}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-lg font-medium">Processing your booking...</p>
      <p className="text-sm text-muted-foreground">
        Please wait while we confirm your classes.
      </p>
    </div>
  );
}
