import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { NotificationsList } from "@/components/app/NotificationsList";
import { PageSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Everything addressed to this founder, in one list — the escalations and the
 * digest that go out over a channel, and the thirteen `ops_*` feed types that
 * never leave the database.
 *
 * /admin already shows two of those thirteen (`session_issue` and
 * `private_request_parked`), which means eleven kinds of thing the worker
 * deliberately files instead of sending have had nowhere to be read. Deliberate
 * silence and an invisible message look identical from the founder's side, and
 * a push banner makes that worse: it can be dismissed, and then the only copy
 * of what it said is a row nobody renders. No type filter here on purpose —
 * this is the raw record, and /admin stays the curated one.
 */
async function Notifications() {
  const { supabase, user } = await requireUser("/admin/notifications");
  const { data: rows } = await supabase
    .from("notifications")
    .select("id,type,title,body,data,read_at,created_at")
    .eq("user_id", user.id)
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  return <NotificationsList rows={rows ?? []} />;
}

export default function AdminNotificationsPage() {
  return (
    <AdminShell title="Notifications">
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <Notifications />
        </Suspense>
      </div>
    </AdminShell>
  );
}
