"use client";

import { useState } from "react";
import Link from "next/link";
import { LocationCard } from "@/components/booking/location-card";
import { BatchSelectionModal } from "@/components/booking/batch-selection-modal";
import { Card, CardContent } from "@/components/ui/card";
import { User, ArrowRight } from "lucide-react";
import type { Location } from "@/types/database";

interface BookingPageClientProps {
  locations: Location[];
}

export function BookingPageClient({ locations }: BookingPageClientProps) {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(
    null
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Book a Class</h1>
        <p className="mt-1 text-muted-foreground">
          Select a location to view available group batches, or book a private
          session
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/book/private" className="block h-full">
          <Card className="h-full border-dashed border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-colors cursor-pointer">
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

        {locations.map((location) => (
          <LocationCard
            key={location.id}
            location={location}
            onViewBatches={setSelectedLocation}
          />
        ))}
      </div>

      <BatchSelectionModal
        location={selectedLocation}
        onClose={() => setSelectedLocation(null)}
      />
    </div>
  );
}
