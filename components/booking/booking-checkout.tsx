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

  const handleContinueWithGoogle = async () => {
    setLoading(true);

    // Store booking data without name/phone (will be resolved from profile after auth)
    const pending: PendingBooking = {
      type: bookingType,
      data: {
        ...bookingData,
        userName: "",
        phoneNumber: "",
      } as GroupBookingPayload | PrivateBookingPayload,
    };
    localStorage.setItem("pendingBooking", JSON.stringify(pending));

    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/book/complete`,
      },
    });
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
            variant="outline"
            className="w-full gap-2"
            size="lg"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {loading ? "Redirecting..." : "Continue with Google"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
