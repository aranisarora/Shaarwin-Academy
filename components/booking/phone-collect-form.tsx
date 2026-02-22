"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PhoneCollectFormProps {
  onComplete: (phoneNumber: string) => void;
  loading?: boolean;
}

export function PhoneCollectForm({ onComplete, loading }: PhoneCollectFormProps) {
  const [phoneNumber, setPhoneNumber] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (phoneNumber.trim()) {
      onComplete(phoneNumber.trim());
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
            <Label htmlFor="phone-collect">Phone Number</Label>
            <Input
              id="phone-collect"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Enter your phone number"
              type="tel"
              required
            />
          </div>
          <Button
            type="submit"
            disabled={!phoneNumber.trim() || loading}
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
