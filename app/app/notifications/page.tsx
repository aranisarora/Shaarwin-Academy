import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ClientShell } from "@/components/app/ClientShell";
import { NotificationsList } from "@/components/app/NotificationsList";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { supabase, user } = await requireUser("/app/notifications");
  const { data: rows } = await supabase
    .from("notifications")
    .select("id,type,title,body,data,read_at,created_at")
    .eq("user_id", user.id)
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <ClientShell title="Notifications">
      <div className="mx-auto max-w-2xl">
        <NotificationsList rows={rows ?? []} />
      </div>
    </ClientShell>
  );
}
