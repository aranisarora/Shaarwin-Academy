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
import { UserPlus } from "lucide-react";
import type { Batch, Location, Profile } from "@/types/database";
import { formatTime } from "@/lib/utils";
import { PRICING } from "@/config/pricing";

interface BatchSelectionModalProps {
  location: Location | null;
  onClose: () => void;
  /** Pre-selected batch IDs when resuming after account creation */
  initialBatchIds?: number[];
}

export function BatchSelectionModal({
  location,
  onClose,
  initialBatchIds = [],
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

  // Payment state (only reached after auth)
  const [showPayment, setShowPayment] = useState(false);

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
      return;
    }

    async function fetchData() {
      setLoading(true);
      setShowPayment(false);

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

      // Pre-select batches when resuming after account creation
      if (initialBatchIds.length > 0 && fetchedBatches.length > 0) {
        const initial = fetchedBatches.filter((b) =>
          initialBatchIds.includes(b.id)
        );
        if (initial.length > 0) setSelectedBatches(initial);
      }

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
          // Non-critical
        }
      }

      setLoading(false);
    }

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const needsPhone = isAuthenticated && profile && !profile.phone_number;

  // Batch cards are locked once the user moves to the payment step
  const batchesLocked = showPayment;

  /** Redirect unauthenticated users to account creation, saving booking context */
  const handleCreateAccount = (redirectTo = "/register") => {
    if (!location) return;
    const pending = {
      locationId: location.id,
      batchIds: selectedBatches.map((b) => b.id),
    };
    localStorage.setItem("pendingGroupBooking", JSON.stringify(pending));
    onClose();
    router.push(`${redirectTo}?next=/book`);
  };

  const handleConfirmBooking = async () => {
    if (selectedBatches.length === 0) return;
    setSubmitting(true);

    try {
      const userName = profile?.full_name || "";
      const phone = needsPhone
        ? phoneNumber.trim()
        : profile?.phone_number || "";

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
                  locked={batchesLocked}
                  onToggle={toggleBatch}
                />
              ))}
            </div>

            {batchesLocked && (
              <p className="text-xs text-muted-foreground text-center -mt-1">
                Batch selection is locked during payment
              </p>
            )}

            {selectedBatches.length > 0 && authChecked && (
              <div className="border-t pt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {selectedBatches.length} batch
                  {selectedBatches.length > 1 ? "es" : ""} selected
                </p>

                {/* ── Unauthenticated: create account first ── */}
                {!isAuthenticated && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      You need an account to book classes. It only takes a
                      minute to get started.
                    </p>
                    <Button
                      onClick={() => handleCreateAccount("/register")}
                      className="w-full gap-2"
                      size="lg"
                    >
                      <UserPlus className="h-4 w-4" />
                      Create Account to Book
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Already have an account?{" "}
                      <button
                        onClick={() => handleCreateAccount("/login")}
                        className="underline font-medium text-foreground hover:text-primary"
                      >
                        Sign in
                      </button>
                    </p>
                  </div>
                )}

                {/* ── Authenticated: payment flow ── */}
                {isAuthenticated && !showPayment && (
                  <div className="space-y-3">
                    {needsPhone && (
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
                    )}
                    <Button
                      onClick={() => setShowPayment(true)}
                      disabled={needsPhone ? !phoneNumber.trim() : false}
                      className="w-full"
                      size="lg"
                    >
                      Proceed to Payment
                    </Button>
                  </div>
                )}

                {isAuthenticated && showPayment && (
                  <PaymentStep
                    onBack={() => setShowPayment(false)}
                    onConfirmed={handleConfirmBooking}
                    totalAmount={selectedBatches.length * PRICING.groupBatchPrice}
                    founderPhone={process.env.NEXT_PUBLIC_FOUNDER_WHATSAPP ?? ""}
                    whatsappMessage={[
                      `Hi, I'd like to book group classes at ${location?.name}${location?.address ? ` (${location.address})` : ""}.`,
                      `Name: ${profile?.full_name || ""}`,
                      `Phone: ${needsPhone ? phoneNumber.trim() : (profile?.phone_number || "")}`,
                      `Batches: ${selectedBatches.map((b) => `${b.title} (${b.day_codes.join("/")} ${formatTime(b.start_time)}–${formatTime(b.end_time)})`).join(", ")}`,
                      `Total: ₹${(selectedBatches.length * PRICING.groupBatchPrice).toLocaleString("en-IN")}`,
                    ].join("\n")}
                  />
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
