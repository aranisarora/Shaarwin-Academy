"use client";

import { useState } from "react";
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
import { MapPin, ArrowLeft, ArrowRight } from "lucide-react";

export function PrivateStepper() {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  // Step 1: Location
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");

  // Step 2: Schedule
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [frequency, setFrequency] = useState<"one-time" | "weekly">("weekly");

  const locationComplete = locationName.trim().length > 0;
  const scheduleComplete = slots.length > 0;

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

      {/* Step 1: Location */}
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
              <Label htmlFor="locationAddress">
                Address{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
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

      {/* Step 2: Schedule */}
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
                onClick={() => setCurrentStep(3)}
                disabled={!scheduleComplete}
                className="flex-1 gap-2"
              >
                Next: Payment
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Payment */}
      {currentStep === 3 && !paymentConfirmed && (
        <Card>
          <CardContent className="p-6">
            <PaymentStep
              stepNumber={3}
              onBack={() => setCurrentStep(2)}
              onConfirmed={() => setPaymentConfirmed(true)}
            />
          </CardContent>
        </Card>
      )}

      {/* Checkout — shown after payment is confirmed */}
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
                    ? "Weekly (4 months)"
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
