"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";
import type { Location } from "@/types/database";

interface LocationCardProps {
  location: Location;
  onViewBatches: (location: Location) => void;
}

export function LocationCard({ location, onViewBatches }: LocationCardProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg">{location.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <span>{location.address}</span>
        </div>
        <Button
          onClick={() => onViewBatches(location)}
          className="w-full"
          variant="outline"
        >
          View Batches
        </Button>
      </CardContent>
    </Card>
  );
}
