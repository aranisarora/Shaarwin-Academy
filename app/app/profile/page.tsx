import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { asAddressDetails } from "@/lib/address";
import { ClientShell } from "@/components/app/ClientShell";
import { ProfileEditor } from "@/components/app/ProfileEditor";
import { InstallAppCard } from "@/components/app/InstallAppCard";
import { PageSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Profile" };

/** Profile and household — streamed, so the shell paints before auth resolves. */
async function Editor() {
  const { supabase, user, profile } = await requireUser("/app/profile");

  // Only the players list is fetched here. `address_details` used to be
  // re-selected from `profiles` alongside it, but requireUser's select already
  // carries that column (PROFILE_COLUMNS in lib/auth.ts) — it was a second query
  // for a value already in hand.
  const { data: players } = await supabase
    .from("players")
    .select("id,full_name,date_of_birth")
    .eq("client_id", user.id)
    .order("created_at");

  return (
    <ProfileEditor
      profile={{
        fullName: profile.full_name,
        phone: profile.phone ?? "",
        defaultAddress: profile.default_address ?? "",
        addressDetails: asAddressDetails(profile.address_details),
        prefs: profile.notification_prefs ?? {},
      }}
      players={players ?? []}
    />
  );
}

export default function ProfilePage() {
  return (
    <ClientShell title="Profile">
      <div className="mx-auto max-w-xl space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <Editor />
        </Suspense>
        {/* Needs no data — stays outside the boundary, in the first flush. */}
        <InstallAppCard />
      </div>
    </ClientShell>
  );
}
