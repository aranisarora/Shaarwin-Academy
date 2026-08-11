import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { VenueManager } from "@/components/app/VenueManager";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { withVenueAddress } from "@/lib/venue-display";

export const metadata: Metadata = { title: "Venues" };

/** Streamed under the shell — the list needs auth, the chrome does not. */
async function Venues() {
  const { supabase } = await requireUser("/admin/venues");
  const { data: venues } = await supabase
    .from("venues")
    .select("id,name,unit,address,postcode,lat,lng,is_public,is_school,address_details")
    .order("name");

  return <VenueManager venues={withVenueAddress(venues)} />;
}

export default function AdminVenuesPage() {
  return (
    <AdminShell title="Venues">
      <div className="mx-auto max-w-3xl">
        <Suspense fallback={<PageSkeleton />}>
          <Venues />
        </Suspense>
      </div>
    </AdminShell>
  );
}
