import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { AttentionRow } from "@/components/app/AttentionRow";
import { NotificationsList } from "@/components/app/NotificationsList";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { fetchAttention } from "@/lib/admin-attention";

export const metadata: Metadata = { title: "Alerts" };

/**
 * Two lists, in the order they matter: what is waiting on him, then everything
 * addressed to him.
 *
 * The top half moved here from the old Today tab, which is gone — its other
 * half was a copy of the Schedule's first day. Putting it above the feed rather
 * than on its own screen ends a genuine duplication: this app had two inboxes,
 * one curated and one raw, and the curated one was hiding on a dashboard while
 * the raw one was buried in More.
 *
 * No type filter on the feed, on purpose. It is the raw record — the
 * escalations and digests that go out over a channel, and the thirteen `ops_*`
 * types that never leave the database. Deliberate silence and an invisible
 * message look identical from the founder's side, and a push banner makes that
 * worse: it can be dismissed, and then the only copy of what it said is a row
 * nobody renders.
 */
async function Alerts() {
  const { supabase, user } = await requireUser("/admin/notifications");

  const [attention, { data: rows }] = await Promise.all([
    fetchAttention(supabase),
    supabase
      .from("notifications")
      .select("id,type,title,body,data,read_at,created_at")
      .eq("user_id", user.id)
      .lte("scheduled_for", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="label mb-3">Needs you</h2>
        {attention.length === 0 ? (
          <div className="rounded-[12px] border border-line bg-surface-2 px-4 py-3">
            <p className="text-sm text-fg-2">
              Nothing needs you — reminders, bookings and reschedules are handled
              automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {attention.map((a) => (
              <AttentionRow
                key={a.key}
                href={a.href}
                title={a.title}
                detail={a.detail}
                action={a.action}
                urgent={a.urgent}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="label mb-3">Everything else</h2>
        <NotificationsList rows={rows ?? []} />
      </section>
    </div>
  );
}

export default function AdminAlertsPage() {
  return (
    <AdminShell title="Alerts">
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <Alerts />
        </Suspense>
      </div>
    </AdminShell>
  );
}
