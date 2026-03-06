"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LocationCard } from "@/components/booking/location-card";
import { BatchSelectionModal } from "@/components/booking/batch-selection-modal";
import { BookingMap } from "@/components/booking/booking-map";
import { Card, CardContent } from "@/components/ui/card";
import { User, ArrowRight } from "lucide-react";
import type { Location } from "@/types/database";

interface BookingPageClientProps {
  locations: Location[];
}

export function BookingPageClient({ locations }: BookingPageClientProps) {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [resumeBatchIds, setResumeBatchIds] = useState<number[]>([]);
  const focusMarkerRef = useRef<((id: number) => void) | null>(null);

  const handleMapReady = (fn: (id: number) => void) => {
    focusMarkerRef.current = fn;
  };

  const handleViewOnMap = (locationId: number) => {
    focusMarkerRef.current?.(locationId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // After account creation, user is redirected back to /book.
  // Re-open the correct location modal with the previously selected batches.
  useEffect(() => {
    const raw = localStorage.getItem("pendingGroupBooking");
    if (!raw) return;

    try {
      const { locationId, batchIds } = JSON.parse(raw) as {
        locationId: number;
        batchIds: number[];
      };
      const loc = locations.find((l) => l.id === locationId);
      if (loc && batchIds?.length) {
        localStorage.removeItem("pendingGroupBooking");
        setResumeBatchIds(batchIds);
        setSelectedLocation(loc);
      } else {
        localStorage.removeItem("pendingGroupBooking");
      }
    } catch {
      localStorage.removeItem("pendingGroupBooking");
    }
  }, [locations]);

  const handleClose = () => {
    setSelectedLocation(null);
    setResumeBatchIds([]);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Book a Class</h1>
        <p className="mt-1 text-muted-foreground">
          Select a location to view available group batches, or book a private session
        </p>
      </div>

      {/* Top row: Map (2/3) + Private Class card (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <BookingMap locations={locations} onMapReady={handleMapReady} />
        </div>
        <div className="lg:col-span-1">
          <Link href="/book/private" className="block h-full">
            <Card className="h-full min-h-[400px] border-dashed border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="flex flex-col items-center justify-center text-center h-full py-8 gap-3">
                <div className="rounded-full bg-primary/10 p-3">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-lg">Book a Private Class</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    1-on-1 sessions at your preferred time and location
                  </p>
                </div>
                <div className="flex items-center gap-1 text-sm font-medium text-primary mt-1">
                  Get started <ArrowRight className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Group class cards */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Group Classes</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((location) => (
            <LocationCard
              key={location.id}
              location={location}
              onViewBatches={setSelectedLocation}
              onViewOnMap={handleViewOnMap}
            />
          ))}
        </div>
      </div>

      <BatchSelectionModal
        location={selectedLocation}
        onClose={handleClose}
        initialBatchIds={resumeBatchIds}
      />
    </div>
  );
}
