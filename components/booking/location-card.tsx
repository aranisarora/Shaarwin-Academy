"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Map, ExternalLink } from "lucide-react";
import type { Location } from "@/types/database";

interface LocationCardProps {
  location: Location;
  onViewBatches: (location: Location) => void;
  onViewOnMap: (locationId: number) => void;
}

export function LocationCard({ location, onViewBatches, onViewOnMap }: LocationCardProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg">{location.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => onViewOnMap(location.id)}
        >
          <Map className="h-4 w-4" /> View on Map
        </Button>

        {location.address?.startsWith("http") && (
          <Button variant="outline" size="sm" className="w-full gap-2" asChild>
            <a href={location.address} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Open in Google Maps
            </a>
          </Button>
        )}

        <Button onClick={() => onViewBatches(location)} className="w-full" size="sm">
          View Batches
        </Button>
      </CardContent>
    </Card>
  );
}
