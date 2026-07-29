import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { VenueManager } from "@/components/app/VenueManager";
import { withVenueAddress } from "@/lib/venue-display";

export const metadata: Metadata = { title: "Venues" };

export default async function AdminVenuesPage() {
  const { supabase } = await requireUser("/admin/venues");
  const { data: venues } = await supabase
    .from("venues")
    .select("id,name,address,postcode,lat,lng,active,address_details")
    .order("name");

  return (
    <AdminShell title="Venues">
      <div className="mx-auto max-w-3xl">
        <VenueManager venues={withVenueAddress(venues)} />
      </div>
    </AdminShell>
  );
}
