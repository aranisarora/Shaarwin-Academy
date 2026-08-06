import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { NotificationsList } from "@/components/app/NotificationsList";
import { PageSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Notifications" };

/**
 * The coach's own list of what we've sent them. It only existed for clients
 * until now, which was fine while WhatsApp was the only channel — a coach could
 * scroll their chat. A push banner has no history: it is gone the moment it is
 * dismissed, and everything it carried (a cover offer, a T-60 prompt, a class
 * that moved) was then unrecoverable. NotificationsList is role-agnostic, so
 * this is the same list the client app has, read for whoever is signed in.
 */
async function Notifications() {
  const { supabase, user } = await requireUser("/coach/notifications");
  const { data: rows } = await supabase
    .from("notifications")
    .select("id,type,title,body,data,read_at,created_at")
    .eq("user_id", user.id)
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  return <NotificationsList rows={rows ?? []} />;
}

export default function CoachNotificationsPage() {
  return (
    <CoachShell title="Notifications">
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <Notifications />
        </Suspense>
      </div>
    </CoachShell>
  );
}
