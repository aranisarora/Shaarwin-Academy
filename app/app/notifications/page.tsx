import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { ClientShell } from "@/components/app/ClientShell";
import { NotificationsList } from "@/components/app/NotificationsList";
import { PageSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Notifications" };

/** Streamed under the shell — the list needs auth, the chrome does not. */
async function Notifications() {
  const { supabase, user } = await requireUser("/app/notifications");
  const { data: rows } = await supabase
    .from("notifications")
    .select("id,type,title,body,data,read_at,created_at")
    .eq("user_id", user.id)
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  return <NotificationsList rows={rows ?? []} />;
}

export default function NotificationsPage() {
  return (
    <ClientShell title="Notifications">
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <Notifications />
        </Suspense>
      </div>
    </ClientShell>
  );
}
