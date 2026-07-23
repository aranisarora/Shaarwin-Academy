import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { academyToday, utcToAcademyWall } from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SessionCard } from "@/components/app/ClassCard";
import { WhatsAppAssistantCard } from "@/components/app/WhatsAppAssistantCard";
import { fetchWeekSessions } from "@/app/admin/schedule/actions";

export const metadata: Metadata = { title: "Today" };

export default async function AdminTodayPage() {
  const { supabase } = await requireUser("/admin");
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86400000);
  const today = academyToday();

  const [
    week,
    subs,
    invoices,
    sessionsWeek,
    unassigned,
    pastDue,
    timeOff,
    issues,
  ] = await Promise.all([
    // Reuse the Schedule's exact session shape (venue resolution, private-client
    // names, badges) — the empty nextByClass is fine, Today shows real times.
    fetchWeekSessions(today, {}),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "trialing"]),
    supabase
      .from("invoices")
      .select("amount_pence")
      .eq("status", "paid")
      .gte("paid_at", new Date(now.getTime() - 30 * 86400000).toISOString()),
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

  // Only today's sessions (the week fetch is IST-midnight anchored on today).
  const todaySessions = week.sessions.filter(
    (s) => utcToAcademyWall(new Date(s.starts_at)).date === today
  );

  const revenue = (invoices.data ?? []).reduce((s, r) => s + r.amount_pence, 0);
  const exceptions =
    (unassigned.data?.length ?? 0) +
    (pastDue.data?.length ?? 0) +
    (timeOff.data?.length ?? 0) +
    (issues.data?.length ?? 0);

  return (
    <AdminShell title="Today">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* ── Section 1: today's classes — the courtside glance ── */}
        <section>
          <h2 className="label mb-3">Today&apos;s classes</h2>
          {todaySessions.length === 0 ? (
            <Card>
              <Card.Content>
                <p className="text-fg-2">No classes today.</p>
              </Card.Content>
            </Card>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {todaySessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  href={`/admin/schedule?session=${s.id}`}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Section 2: needs your attention — every row opens the item ── */}
        <section>
          <h2 className="label mb-3">Needs your attention</h2>
          {exceptions === 0 ? (
            <Card>
              <Card.Content>
                <p className="text-fg-2">
                  Nothing needs you — reminders, bookings and reschedules are handled
                  automatically.
                </p>
              </Card.Content>
            </Card>
          ) : (
            <div className="space-y-3">
              {(unassigned.data ?? []).map((s) => (
                <Link
                  key={s.id}
                  href={`/admin/schedule?session=${s.id}&date=${utcToAcademyWall(new Date(s.starts_at)).date}`}
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
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
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
                  href={`/admin/coaches?coach=${t.coach_id}`}
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
                  href={`/admin/players?view=clients&client=${s.client_id}`}
                  className="flex items-center justify-between rounded-[12px] border border-err bg-surface-2 px-4 py-3 hover:bg-surface"
                >
                  <p className="font-medium">
                    Payment past due —{" "}
                    {(s.profiles as unknown as { full_name: string } | null)?.full_name}
                  </p>
                  <Badge tone="err">Payment overdue</Badge>
                </Link>
              ))}
              {(issues.data ?? []).map((n) => (
                <Link
                  key={n.id}
                  href={(n.data as { url?: string })?.url ?? "/admin/schedule"}
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
        </section>

        {/* ── Section 3: the numbers, demoted to one glanceable strip ── */}
        <Link
          href="/admin/billing"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2 hover:bg-surface"
        >
          <span>
            <span className="tnum font-medium text-fg">{subs.count ?? 0}</span> members
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="tnum font-medium text-fg">
              ₹{(revenue / 100).toLocaleString("en-IN")}
            </span>{" "}
            this month
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="tnum font-medium text-fg">{sessionsWeek.count ?? 0}</span>{" "}
            classes this week
          </span>
          <span aria-hidden className="ml-auto text-fg-2">
            →
          </span>
        </Link>

        <WhatsAppAssistantCard />
      </div>
    </AdminShell>
  );
}
