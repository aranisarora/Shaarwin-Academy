import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatPrice } from "@/lib/data";

export const metadata: Metadata = { title: "Billing" };

export default async function AdminBillingPage() {
  const { supabase } = await requireUser("/admin/billing");

  const [{ data: plans }, { data: subs }, { data: graceDaysRow }] = await Promise.all([
    supabase
      .from("plans")
      .select("id,name,price_pence,group_sessions_per_week,private_minutes_per_quarter,razorpay_plan_id,active")
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
    <AdminShell title="Billing">
      <div className="mx-auto max-w-3xl space-y-8">
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
                      ? "Unlimited group"
                      : `${p.group_sessions_per_week}/week group`}
                    {p.private_minutes_per_quarter > 0 &&
                      ` · ${p.private_minutes_per_quarter} private min`}
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
            <p className="label mb-3">Dunning — payment past due</p>
            <ul className="divide-y divide-line rounded-[12px] border border-err bg-surface-2">
              {dunning.map((s) => {
                const profile = s.profiles as unknown as { full_name: string; email: string } | null;
                const daysLeft = s.current_period_end
                  ? Math.max(
                      0,
                      Math.ceil(
                        (new Date(s.current_period_end).getTime() +
                          graceDays * 86400000 -
                          Date.now()) /
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
              const profile = s.profiles as unknown as { full_name: string } | null;
              const plan = s.plans as unknown as { name: string } | null;
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
      </div>
    </AdminShell>
  );
}
