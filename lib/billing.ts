import type { SupabaseClient } from "@supabase/supabase-js";

export type SubscriptionSummary = {
  status: string | null;
  planName: string | null;
  planId: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  minutesBalance: number;
  active: boolean;
};

/**
 * Mirrors has_active_subscription() for reads. Bookings enforce the SQL
 * function server-side; this powers screens.
 */
export async function getSubscriptionSummary(
  supabase: SupabaseClient,
  clientId: string,
  graceDays = 7
): Promise<SubscriptionSummary> {
  const [{ data: sub }, { data: ledger }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("status,current_period_end,cancel_at_period_end,plans(id,name)")
      .eq("client_id", clientId)
      .in("status", ["active", "trialing", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("private_credit_ledger")
      .select("delta_minutes")
      .eq("client_id", clientId),
  ]);

  const minutesBalance = (ledger ?? []).reduce(
    (sum, row) => sum + row.delta_minutes,
    0
  );

  if (!sub) {
    return {
      status: null,
      planName: null,
      planId: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      minutesBalance,
      active: false,
    };
  }

  const plan = sub.plans as unknown as { id: string; name: string } | null;
  const inGrace =
    sub.status === "past_due" &&
    sub.current_period_end !== null &&
    Date.now() <=
      new Date(sub.current_period_end).getTime() + graceDays * 86400000;

  return {
    status: sub.status,
    planName: plan?.name ?? null,
    planId: plan?.id ?? null,
    periodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    minutesBalance,
    active: ["active", "trialing"].includes(sub.status) || inGrace,
  };
}

export function formatRenewalDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}
