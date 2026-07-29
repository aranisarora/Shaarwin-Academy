import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { SettingsEditor } from "@/components/app/SettingsEditor";
import { InstallAppCard } from "@/components/app/InstallAppCard";
import { SignOutButton } from "@/components/app/SignOutButton";
import { PageSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Settings" };

const EDITABLE_KEYS = [
  "cancellation_window_hours",
  "booking_cutoff_minutes",
  "travel_buffer_minutes",
  "reschedule_max_hops",
  "dunning_grace_days",
  "waitlist_claim_minutes",
];

/** The editable booking rules — streamed, so the shell paints first. */
async function Settings() {
  const { supabase } = await requireUser("/admin/settings");
  const { data: rows } = await supabase
    .from("settings")
    .select("key,value")
    .in("key", EDITABLE_KEYS);

  const values = Object.fromEntries(
    (rows ?? []).map((r) => [r.key, Number(r.value)])
  );

  return <SettingsEditor values={values} />;
}

export default function AdminSettingsPage() {
  return (
    <AdminShell title="Settings" actions={<SignOutButton />}>
      <div className="mx-auto max-w-xl space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <Settings />
        </Suspense>
        {/* Needs no data — stays outside the boundary, in the first flush. */}
        <InstallAppCard />
      </div>
    </AdminShell>
  );
}
