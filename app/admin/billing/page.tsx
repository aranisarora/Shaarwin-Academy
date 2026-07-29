import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { formatPrice } from "@/lib/data";
import { nowMs } from "@/lib/academy-time";

export const metadata: Metadata = { title: "Billing" };

/** Plans, dunning and subscriptions — streamed under the shell. */
async function Billing() {
  const { supabase } = await requireUser("/admin/billing");

  const [{ data: plans }, { data: subs }, { data: graceDaysRow }] = await Promise.all([
    supabase
      .from("plans")
      .select("id,name,price_pence,group_sessions_per_week,private_minutes_per_cycle,razorpay_plan_id,active")
      .eq("active", true)
      .order("price_pence"),
    supabase
      .from("subscriptions")
      .select(
        "id,status,source,current_period_end,cancel_at_period_end,profiles!subscriptions_client_id_fkey(full_name,email),plans(name)"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("settings").select("value").eq("key", "dunning_grace_days").maybeSingle(),
  ]);

  const graceDays = Number(graceDaysRow?.value ?? 7);
  const dunning = (subs ?? []).filter((s) => s.status === "past_due");

  return (
    <>
      <div>
        <p className="label mb-3">Plans</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(plans ?? []).map((p) => (
            <Card key={p.id}>
              <Card.Content className="p-4">
                <p className="font-medium">{p.name}</p>
                <p className="font-display tnum text-2xl">{formatPrice(p.price_pence)}</p>
                <p className="mt-1 text-xs text-fg-2">
                  {p.group_sessions_per_week === null
                    ? "Unlimited group (legacy)"
                    : p.group_sessions_per_week > 0
                      ? `${p.group_sessions_per_week}/week group`
                      : "Private only"}
                  {p.private_minutes_per_cycle > 0 &&
                    ` · ${p.private_minutes_per_cycle} private min/mo`}
                </p>
                <Badge className="mt-2" tone={p.razorpay_plan_id ? "ok" : "err"}>
                  {p.razorpay_plan_id ? "Razorpay linked" : "No Razorpay plan"}
                </Badge>
              </Card.Content>
            </Card>
          ))}
        </div>
        <p className="mt-2 text-xs text-fg-2">
          Price changes: never mutate a Razorpay Plan — run{" "}
          <code>node scripts/razorpay-setup.mjs</code> after creating a new plan row;
          existing subscribers stay on the plan they signed up on.
        </p>
      </div>

      {dunning.length > 0 && (
        <div>
          <p className="label mb-3">Payment overdue</p>
          <ul className="divide-y divide-line rounded-[12px] border border-err bg-surface-2">
            {dunning.map((s) => {
              const profile = s.profiles;
              const daysLeft = s.current_period_end
                ? Math.max(
                    0,
                    Math.ceil(
                      (new Date(s.current_period_end).getTime() +
                        graceDays * 86400000 -
                        nowMs()) /
                        86400000
                    )
                  )
                : 0;
              return (
                <li key={s.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium">{profile?.full_name}</p>
                    <p className="text-sm text-fg-2">{profile?.email}</p>
                  </div>
                  <Badge tone="err">{daysLeft}d of grace left</Badge>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <p className="label mb-3">Subscriptions</p>
        <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
          {(subs ?? []).map((s) => {
            const profile = s.profiles;
            const plan = s.plans;
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{profile?.full_name}</p>
                  <p className="text-sm text-fg-2">
                    {plan?.name} · {s.source}
                    {s.cancel_at_period_end ? " · ends at period end" : ""}
                  </p>
                </div>
                <Badge
                  tone={
                    s.status === "active" || s.status === "trialing"
                      ? "ok"
                      : s.status === "past_due"
                        ? "err"
                        : "neutral"
                  }
                >
                  {s.status}
                </Badge>
              </li>
            );
          })}
          {(subs ?? []).length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-fg-2">No subscriptions yet.</li>
          )}
        </ul>
      </div>
    </>
  );
}

export default function AdminBillingPage() {
  return (
    <AdminShell title="Billing">
      <div className="mx-auto max-w-3xl space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <Billing />
        </Suspense>
      </div>
    </AdminShell>
  );
}
