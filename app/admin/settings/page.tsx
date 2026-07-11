import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { SettingsEditor } from "@/components/app/SettingsEditor";
import { InstallAppCard } from "@/components/app/InstallAppCard";
import { SignOutButton } from "@/components/app/SignOutButton";

export const metadata: Metadata = { title: "Settings" };

const EDITABLE_KEYS = [
  "cancellation_window_hours",
  "booking_cutoff_minutes",
  "travel_buffer_minutes",
  "reschedule_max_hops",
  "dunning_grace_days",
  "waitlist_claim_minutes",
];

export default async function AdminSettingsPage() {
  const { supabase } = await requireUser("/admin/settings");
  const { data: rows } = await supabase
    .from("settings")
    .select("key,value")
    .in("key", EDITABLE_KEYS);

  const values = Object.fromEntries(
    (rows ?? []).map((r) => [r.key, Number(r.value)])
  );

  return (
    <AdminShell title="Settings" actions={<SignOutButton />}>
      <div className="mx-auto max-w-xl space-y-8">
        <SettingsEditor values={values} />
        <InstallAppCard />
      </div>
    </AdminShell>
  );
}
