"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BatchCard } from "@/components/booking/batch-card";
import { PaymentStep } from "@/components/booking/payment-step";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getBatchBookingCounts,
  getUserBookedBatchIds,
  createGroupBooking,
} from "@/actions/bookings";
import { getProfile } from "@/actions/auth";
import { toast } from "sonner";
import type { Batch, Location, Profile } from "@/types/database";

interface BatchSelectionModalProps {
  location: Location | null;
  onClose: () => void;
}

export function BatchSelectionModal({
  location,
  onClose,
}: BatchSelectionModalProps) {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [bookingCounts, setBookingCounts] = useState<Record<number, number>>(
    {}
  );
  const [bookedBatchIds, setBookedBatchIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedBatches, setSelectedBatches] = useState<Batch[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Payment state
  const [showPayment, setShowPayment] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  // Auth state
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  useEffect(() => {
    if (!location) {
      setBatches([]);
      setSelectedBatches([]);
      setLoading(true);
      setAuthChecked(false);
      setShowPayment(false);
      setPaymentConfirmed(false);
      return;
    }

    async function fetchData() {
      setLoading(true);
      setSelectedBatches([]);

      const supabase = createClient();

      const [batchResult, profileResult] = await Promise.all([
        supabase
          .from("batches")
          .select("*, location:locations(*)")
          .eq("location_id", location!.id)
          .eq("is_active", true)
          .order("start_time"),
        getProfile(),
      ]);

      // Check auth
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);
      setProfile(profileResult);
      setAuthChecked(true);

      if (batchResult.error) {
        toast.error(`Failed to load batches: ${batchResult.error.message}`);
        setLoading(false);
        return;
      }

      const fetchedBatches = (batchResult.data || []) as Batch[];
      setBatches(fetchedBatches);

      if (fetchedBatches.length > 0) {
        try {
          const batchIds = fetchedBatches.map((b) => b.id);
          const [counts, userBooked] = await Promise.all([
            getBatchBookingCounts(batchIds),
            getUserBookedBatchIds(batchIds),
          ]);
          setBookingCounts(counts);
          setBookedBatchIds(new Set(userBooked));
        } catch {
          // Non-critical - counts default to 0
        }
      }

      setLoading(false);
    }

    fetchData();
  }, [location]);

  const toggleBatch = (batch: Batch) => {
    setSelectedBatches((prev) => {
      const exists = prev.find((b) => b.id === batch.id);
      if (exists) return prev.filter((b) => b.id !== batch.id);
      return [...prev, batch];
    });
  };

  const isSelected = (batchId: number) =>
    selectedBatches.some((b) => b.id === batchId);

  const hasCompleteProfile = profile?.full_name && profile?.phone_number;
  const needsPhone = isAuthenticated && profile && !profile.phone_number;

  const handleConfirmBooking = async () => {
    if (selectedBatches.length === 0) return;
    setSubmitting(true);

    try {
      const userName = profile?.full_name || "";
      const phone = needsPhone ? phoneNumber.trim() : (profile?.phone_number || "");

      if (needsPhone && !phone) {
        toast.error("Please enter your phone number");
        setSubmitting(false);
        return;
      }

      await createGroupBooking({
        batchIds: selectedBatches.map((b) => b.id),
        userName,
        phoneNumber: phone,
      });

      toast.success("Booking confirmed! Check your Google Calendar.");
      onClose();
      router.push("/dashboard/bookings");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Booking failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinueWithGoogle = async () => {
    if (selectedBatches.length === 0) return;
    setSubmitting(true);

    const pending = {
      type: "group" as const,
      data: {
        batchIds: selectedBatches.map((b) => b.id),
      },
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

  const GoogleIcon = () => (
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
  );

  return (
    <Dialog open={!!location} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{location?.name || "Select Batches"}</DialogTitle>
          <DialogDescription>
            {location?.address
              ? `${location.address} — Select the batches you want to join`
              : "Select the batches you want to join"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : batches.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No batches available at this location.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {batches.map((batch) => (
                <BatchCard
                  key={batch.id}
                  batch={batch}
                  bookingCount={bookingCounts[batch.id] || 0}
                  selected={isSelected(batch.id)}
                  booked={bookedBatchIds.has(batch.id)}
                  onToggle={toggleBatch}
                />
              ))}
            </div>

            {/* Footer: payment gate → auth-aware booking section */}
            {selectedBatches.length > 0 && authChecked && (
              <div className="border-t pt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {selectedBatches.length} batch
                  {selectedBatches.length > 1 ? "es" : ""} selected
                </p>

                {/* Step 1 of payment gate: prompt to proceed to payment */}
                {!showPayment && !paymentConfirmed && (
                  <Button
                    onClick={() => setShowPayment(true)}
                    className="w-full"
                    size="lg"
                  >
                    Proceed to Payment
                  </Button>
                )}

                {/* Step 2: payment QR + screenshot upload */}
                {showPayment && !paymentConfirmed && (
                  <PaymentStep
                    onBack={() => setShowPayment(false)}
                    onConfirmed={() => {
                      setShowPayment(false);
                      setPaymentConfirmed(true);
                    }}
                  />
                )}

                {/* Step 3: confirm booking after payment */}
                {paymentConfirmed && (
                  <>
                    {isAuthenticated && hasCompleteProfile && (
                      <Button
                        onClick={handleConfirmBooking}
                        disabled={submitting}
                        className="w-full"
                        size="lg"
                      >
                        {submitting
                          ? "Booking..."
                          : `Confirm Booking (${selectedBatches.length} batch${selectedBatches.length > 1 ? "es" : ""})`}
                      </Button>
                    )}

                    {needsPhone && (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="modal-phone">Phone Number</Label>
                          <Input
                            id="modal-phone"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            placeholder="Enter your phone number"
                            type="tel"
                          />
                        </div>
                        <Button
                          onClick={handleConfirmBooking}
                          disabled={submitting || !phoneNumber.trim()}
                          className="w-full"
                          size="lg"
                        >
                          {submitting ? "Booking..." : "Confirm Booking"}
                        </Button>
                      </div>
                    )}

                    {!isAuthenticated && (
                      <Button
                        onClick={handleContinueWithGoogle}
                        disabled={submitting}
                        variant="outline"
                        className="w-full gap-2"
                        size="lg"
                      >
                        <GoogleIcon />
                        {submitting ? "Redirecting..." : "Continue with Google"}
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
