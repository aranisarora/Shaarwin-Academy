"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { createGroupBooking, createPrivateBooking } from "@/actions/bookings";
import { getProfile } from "@/actions/auth";
import type { Profile } from "@/types/database";
import type { User } from "@supabase/supabase-js";

export interface PendingBooking {
  type: "group" | "private";
  data: GroupBookingPayload | PrivateBookingPayload;
}

export interface GroupBookingPayload {
  batchIds: number[];
  userName: string;
  phoneNumber: string;
}

export interface PrivateBookingPayload {
  locationName: string;
  locationAddress: string;
  slots: Array<{ day: string; startTime: string }>;
  frequency: "one-time" | "weekly";
  userName: string;
  phoneNumber: string;
}

interface BookingCheckoutProps {
  bookingType: "group" | "private";
  bookingData:
    | Omit<GroupBookingPayload, "userName" | "phoneNumber">
    | Omit<PrivateBookingPayload, "userName" | "phoneNumber">;
  summary: React.ReactNode;
  disabled?: boolean;
}

export function BookingCheckout({
  bookingType,
  bookingData,
  summary,
  disabled,
}: BookingCheckoutProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      setUser(authUser ?? null);

      if (authUser) {
        const p = await getProfile();
        setProfile(p);
      }

      setCheckingAuth(false);
    }
    checkAuth();
  }, []);

  const needsPhone = user && profile && !profile.phone_number;

  const buildPayload = () => {
    const userName = profile?.full_name || "";
    const phone = needsPhone
      ? phoneNumber.trim()
      : profile?.phone_number || "";

    if (bookingType === "group") {
      return {
        ...(bookingData as Omit<GroupBookingPayload, "userName" | "phoneNumber">),
        userName,
        phoneNumber: phone,
      } as GroupBookingPayload;
    }
    return {
      ...(bookingData as Omit<PrivateBookingPayload, "userName" | "phoneNumber">),
      userName,
      phoneNumber: phone,
    } as PrivateBookingPayload;
  };

  const handleDirectBooking = async () => {
    if (needsPhone && !phoneNumber.trim()) {
      toast.error("Please enter your phone number");
      return;
    }
    setLoading(true);
    try {
      const payload = buildPayload();
      if (bookingType === "group") {
        await createGroupBooking(payload as GroupBookingPayload);
      } else {
        await createPrivateBooking(payload as PrivateBookingPayload);
      }
      toast.success("Booking confirmed! Check your Google Calendar.");
      router.push("/dashboard/bookings");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Booking failed");
    } finally {
      setLoading(false);
    }
  };

  const handleContinueWithGoogle = () => {
    setLoading(true);

    // Store booking data — name/phone resolved from profile after auth
    const pending: PendingBooking = {
      type: bookingType,
      data: {
        ...bookingData,
        userName: "",
        phoneNumber: "",
      } as GroupBookingPayload | PrivateBookingPayload,
    };
    localStorage.setItem("pendingBooking", JSON.stringify(pending));

    // Redirect to account creation page which handles phone + Google sign-in
    router.push("/register?next=/book/complete");
  };

  if (checkingAuth) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Complete Your Booking</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {summary}

        {/* Only show phone field if authenticated but missing phone */}
        {needsPhone && (
          <div className="space-y-2">
            <Label htmlFor="checkout-phone">Phone Number</Label>
            <Input
              id="checkout-phone"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Enter your phone number"
              type="tel"
              required
            />
          </div>
        )}

        {user ? (
          <Button
            onClick={handleDirectBooking}
            disabled={loading || disabled}
            className="w-full"
            size="lg"
          >
            {loading ? "Booking..." : "Confirm Booking"}
          </Button>
        ) : (
          <Button
            onClick={handleContinueWithGoogle}
            disabled={loading || disabled}
            className="w-full"
            size="lg"
          >
            {loading ? "Redirecting..." : "Create Account to Book"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
