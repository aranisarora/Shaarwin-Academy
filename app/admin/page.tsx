import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { WhatsAppConnect } from "@/components/app/WhatsAppConnect";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminDashboardPage() {
  const { supabase } = await requireUser("/admin");
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86400000);

  const [subs, invoices, sessionsWeek, unassigned, pastDue, timeOff, issues] =
    await Promise.all([
      supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .in("status", ["active", "trialing"]),
      supabase
        .from("invoices")
        .select("amount_pence")
        .eq("status", "paid")
        .gte("paid_at", new Date(now.getTime() - 90 * 86400000).toISOString()),
      supabase
        .from("class_sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled")
        .gte("starts_at", now.toISOString())
        .lt("starts_at", weekAhead.toISOString()),
      supabase
        .from("class_sessions")
        .select("id,starts_at,classes(title)")
        .is("coach_id", null)
        .eq("status", "scheduled")
        .gte("starts_at", now.toISOString())
        .order("starts_at")
        .limit(10),
      supabase
        .from("subscriptions")
        .select("id,client_id,profiles!subscriptions_client_id_fkey(full_name)")
        .eq("status", "past_due")
        .limit(10),
      supabase
        .from("coach_time_off")
        .select("id,coach_id,starts_at,ends_at,reason,profiles!coach_time_off_coach_id_fkey(full_name)")
        .eq("status", "pending")
        .limit(10),
      supabase
        .from("notifications")
        .select("id,title,body,created_at,data")
        .in("type", ["session_issue", "private_request_parked"])
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const revenue = (invoices.data ?? []).reduce((s, r) => s + r.amount_pence, 0);
  const exceptions =
    (unassigned.data?.length ?? 0) +
    (pastDue.data?.length ?? 0) +
    (timeOff.data?.length ?? 0) +
    (issues.data?.length ?? 0);

  return (
    <AdminShell title="Dashboard">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Active members", String(subs.count ?? 0)],
            ["Revenue this quarter", `£${(revenue / 100).toLocaleString("en-GB")}`],
            ["Sessions this week", String(sessionsWeek.count ?? 0)],
            ["Exceptions", String(exceptions)],
          ].map(([labelText, value]) => (
            <Card key={labelText}>
              <Card.Content className="p-4">
                <p className="label mb-1">{labelText}</p>
                <p className="font-display tnum text-3xl">{value}</p>
              </Card.Content>
            </Card>
          ))}
        </div>

        <WhatsAppConnect />

        <div>
          <h2 className="label mb-3">Exceptions inbox</h2>
          {exceptions === 0 ? (
            <Card>
              <Card.Content>
                <p className="text-fg-2">
                  Empty inbox — the business runs itself today.
                </p>
              </Card.Content>
            </Card>
          ) : (
            <div className="space-y-3">
              {(unassigned.data ?? []).map((s) => (
                <Link
                  key={s.id}
                  href="/admin/calendar"
                  className="flex items-center justify-between rounded-[12px] border border-err bg-surface-2 px-4 py-3 hover:bg-surface"
                >
                  <div>
                    <p className="font-medium">
                      ⚠ Unassigned —{" "}
                      {(s.classes as unknown as { title: string } | null)?.title}
                    </p>
                    <p className="tnum text-sm text-fg-2">
                      {new Intl.DateTimeFormat("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      }).format(new Date(s.starts_at))}
                    </p>
                  </div>
                  <Badge tone="err">Assign</Badge>
                </Link>
              ))}
              {(timeOff.data ?? []).map((t) => (
                <Link
                  key={t.id}
                  href="/admin/coaches"
                  className="flex items-center justify-between rounded-[12px] border border-line bg-surface-2 px-4 py-3 hover:bg-surface"
                >
                  <div>
                    <p className="font-medium">
                      Time off —{" "}
                      {(t.profiles as unknown as { full_name: string } | null)?.full_name}
                    </p>
                    <p className="tnum text-sm text-fg-2">
                      {new Date(t.starts_at).toLocaleDateString("en-GB")} –{" "}
                      {new Date(t.ends_at).toLocaleDateString("en-GB")}
                      {t.reason ? ` · ${t.reason}` : ""}
                    </p>
                  </div>
                  <Badge>Review</Badge>
                </Link>
              ))}
              {(pastDue.data ?? []).map((s) => (
                <Link
                  key={s.id}
                  href="/admin/clients"
                  className="flex items-center justify-between rounded-[12px] border border-line bg-surface-2 px-4 py-3 hover:bg-surface"
                >
                  <p className="font-medium">
                    Payment past due —{" "}
                    {(s.profiles as unknown as { full_name: string } | null)?.full_name}
                  </p>
                  <Badge tone="err">Dunning</Badge>
                </Link>
              ))}
              {(issues.data ?? []).map((n) => (
                <Link
                  key={n.id}
                  href={(n.data as { url?: string })?.url ?? "/admin/calendar"}
                  className="flex items-center justify-between rounded-[12px] border border-line bg-surface-2 px-4 py-3 hover:bg-surface"
                >
                  <div>
                    <p className="font-medium">{n.title}</p>
                    <p className="text-sm text-fg-2">{n.body}</p>
                  </div>
                  <Badge>Open</Badge>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
