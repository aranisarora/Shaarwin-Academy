"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { TimeSlotGrid, addOneHour } from "@/components/booking/time-slot-grid";
import type { TimeSlot } from "@/components/booking/time-slot-grid";
import { FrequencySelector } from "@/components/booking/frequency-selector";
import { BookingCheckout } from "@/components/booking/booking-checkout";
import { PaymentStep } from "@/components/booking/payment-step";
import { formatTime } from "@/lib/utils";
import { MapPin, ArrowLeft, ArrowRight, CalendarCheck, X } from "lucide-react";
import { PRICING } from "@/config/pricing";

export function PrivateStepper() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [authChecking, setAuthChecking] = useState(false);

  // Step 1: Location
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");

  // Step 2: Schedule
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [frequency, setFrequency] = useState<"one-time" | "weekly">("weekly");

  const locationComplete =
    locationName.trim().length > 0 && locationAddress.trim().length > 0;
  const scheduleComplete = slots.length > 0;

  // Restore state if the user was redirected away to create an account
  useEffect(() => {
    const raw = localStorage.getItem("pendingPrivateBooking");
    if (!raw) return;

    async function restoreIfAuthenticated() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      try {
        const saved = JSON.parse(raw!);
        localStorage.removeItem("pendingPrivateBooking");
        setLocationName(saved.locationName || "");
        setLocationAddress(saved.locationAddress || "");
        setSlots(saved.slots || []);
        setFrequency(saved.frequency || "weekly");
        setCurrentStep(3);
      } catch {
        localStorage.removeItem("pendingPrivateBooking");
      }
    }

    restoreIfAuthenticated();
  }, []);

  /** Called when tapping "Next: Payment" in step 2.
   *  Checks auth — redirects unauthenticated users to account creation. */
  const handleNextToPayment = async () => {
    setAuthChecking(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setAuthChecking(false);

    if (!user) {
      // Save booking state so we can resume after sign-in
      const pending = {
        locationName: locationName.trim(),
        locationAddress: locationAddress.trim(),
        slots,
        frequency,
      };
      localStorage.setItem("pendingPrivateBooking", JSON.stringify(pending));
      router.push("/register?next=/book/private");
      return;
    }

    setCurrentStep(3);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Book a Private Session</h1>
        <p className="mt-1 text-muted-foreground">
          Create a custom private class with your preferred schedule
        </p>
      </div>

      {/* Step indicator */}
      <div className="text-sm text-muted-foreground">
        Step {currentStep} of 3
      </div>

      {/* ── Step 1: Location ── */}
      {currentStep === 1 && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                1
              </div>
              <h2 className="text-lg font-semibold">Location Details</h2>
            </div>

            <div className="space-y-2">
              <Label htmlFor="locationName">Location Name</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="locationName"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="e.g. Home, Park, Community Center"
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="locationAddress">Address</Label>
              <Input
                id="locationAddress"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                placeholder="Street address or landmark"
              />
            </div>

            <Button
              onClick={() => setCurrentStep(2)}
              disabled={!locationComplete}
              className="w-full gap-2"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Schedule ── */}
      {currentStep === 2 && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                2
              </div>
              <h2 className="text-lg font-semibold">Schedule</h2>
            </div>

            <TimeSlotGrid selectedSlots={slots} onChange={setSlots} />

            {/* Live slot summary */}
            {slots.length > 0 && (
              <div className="rounded-lg bg-muted/60 border p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CalendarCheck className="h-4 w-4 text-primary" />
                  Selected sessions
                </div>
                <ul className="space-y-1">
                  {slots.map((slot, i) => (
                    <li
                      key={`${slot.day}-${slot.startTime}`}
                      className="flex items-center justify-between text-sm text-muted-foreground"
                    >
                      <span>
                        Every{" "}
                        <span className="font-medium text-foreground">
                          {slot.day}
                        </span>{" "}
                        at{" "}
                        <span className="font-medium text-foreground">
                          {formatTime(slot.startTime)} &ndash;{" "}
                          {formatTime(addOneHour(slot.startTime))}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setSlots(slots.filter((_, idx) => idx !== i))}
                        className="ml-3 rounded-full p-0.5 hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <Label>Frequency</Label>
              <FrequencySelector value={frequency} onChange={setFrequency} />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(1)}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleNextToPayment}
                disabled={!scheduleComplete || authChecking}
                className="flex-1 gap-2"
              >
                {authChecking ? (
                  "Checking…"
                ) : (
                  <>
                    Next: Payment
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Payment ── */}
      {currentStep === 3 && !paymentConfirmed && (
        <Card>
          <CardContent className="p-6">
            <PaymentStep
              stepNumber={3}
              onBack={() => setCurrentStep(2)}
              onConfirmed={() => setPaymentConfirmed(true)}
              totalAmount={slots.length * PRICING.privateSlotPrice}
              whatsappMessage={`Hi, I want to book a private session at ${locationName.trim()} (${locationAddress.trim()}), ${frequency === "weekly" ? "Weekly" : "One-time"}, ${slots.map((s) => `${s.day} ${formatTime(s.startTime)}`).join(" & ")} — ₹${(slots.length * PRICING.privateSlotPrice).toLocaleString("en-IN")}`}
              founderPhone={process.env.NEXT_PUBLIC_FOUNDER_WHATSAPP ?? ""}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Checkout — shown after payment is confirmed ── */}
      {currentStep === 3 && paymentConfirmed && (
        <BookingCheckout
          bookingType="private"
          bookingData={{
            locationName: locationName.trim(),
            locationAddress: locationAddress.trim(),
            slots,
            frequency,
          }}
          summary={
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm font-medium">Session Summary</p>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  Location: {locationName.trim()}
                  {locationAddress.trim()
                    ? ` — ${locationAddress.trim()}`
                    : ""}
                </p>
                <p>
                  Frequency:{" "}
                  {frequency === "weekly"
                    ? "Weekly (reschedulable) — 4 months"
                    : "One-time session"}
                </p>
                <div className="flex items-center gap-1 flex-wrap">
                  <span>Slots:</span>
                  {slots.map((slot) => (
                    <Badge
                      key={`${slot.day}-${slot.startTime}`}
                      variant="outline"
                      className="text-xs"
                    >
                      {slot.day.slice(0, 3)} {formatTime(slot.startTime)}{" "}
                      &ndash; {formatTime(addOneHour(slot.startTime))}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
