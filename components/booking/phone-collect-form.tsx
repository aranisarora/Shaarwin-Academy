"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isValidIndianPhone, normalisePhone } from "@/lib/utils";

interface PhoneCollectFormProps {
  onComplete: (phoneNumber: string) => void;
  loading?: boolean;
}

export function PhoneCollectForm({ onComplete, loading }: PhoneCollectFormProps) {
  const [phoneNumber, setPhoneNumber] = useState("");

  const normalised = normalisePhone(phoneNumber);
  const isValid = isValidIndianPhone(normalised);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid) {
      onComplete(normalised);
    }
  };

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>One more thing...</CardTitle>
        <p className="text-sm text-muted-foreground">
          We need your phone number to complete the booking.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone-collect">WhatsApp Number</Label>
            <Input
              id="phone-collect"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+91 98765 43210"
              type="tel"
              required
            />
            {phoneNumber && !isValid ? (
              <p className="text-xs text-destructive">
                Enter a valid Indian mobile number starting with +91 (e.g. +91 98765 43210)
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Format: +91XXXXXXXXXX</p>
            )}
          </div>
          <Button
            type="submit"
            disabled={!isValid || loading}
            className="w-full"
            size="lg"
          >
            {loading ? "Processing..." : "Complete Booking"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
