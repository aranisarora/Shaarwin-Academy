import { createClient } from "@/lib/supabase/server";
import { BookingPageClient } from "@/components/booking/booking-page-client";
import type { Location } from "@/types/database";

export default async function BookPage() {
  const supabase = await createClient();
  const { data: locations, error } = await supabase
    .from("locations")
    .select("*")
    .eq("type", "public")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
        <p className="text-sm text-destructive">
          Failed to load locations. Please try again later.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {error.message}
        </p>
      </div>
    );
  }

  return <BookingPageClient locations={(locations || []) as Location[]} />;
}
