import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatDate } from "@/lib/academy-time";

export type PlanSummary = {
  planId: string;
  planName: string;
  status: string;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** > 0 weekly cap; null = legacy unlimited (comp). */
  groupSessionsPerWeek: number | null;
  privateMinutesPerCycle: number;
  /** Weekly private-session cap; null = legacy minutes-only. */
  privateSessionsPerWeek: number | null;
  /** Fixed private session length; null = free 60/90 choice. */
  privateSessionMinutes: number | null;
  active: boolean;
};

export type SubscriptionSummary = {
  /** Membership that includes group classes (cap > 0 or legacy null). */
  groupPlan: PlanSummary | null;
  /** Private home-coaching plan (monthly minutes grant). */
  privatePlan: PlanSummary | null;
  minutesBalance: number;
  /** Players who still hold a legacy per-player free trial class. */
  openTrialPlayerIds: string[];
  /** Players whose per-player trial has already been consumed. */
  usedTrialPlayerIds: string[];
  /** Unused account-level free trial — usable by any household player. */
  hasAccountTrial: boolean;
  /** True if an account-level trial was consumed (regardless of open state). */
  accountTrialUsed: boolean;
  /** Purchased drop-in group classes not yet used. */
  dropinCredits: number;
  /** Any alive subscription (either plan). */
  active: boolean;

  // Convenience fields for single-plan screens: the group plan wins, else the
  // private plan.
  status: string | null;
  planName: string | null;
  planId: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type SubRow = {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  plans: {
    id: string;
    name: string;
    group_sessions_per_week: number | null;
    private_minutes_per_cycle: number;
    private_sessions_per_week: number | null;
    private_session_minutes: number | null;
  } | null;
};

function isAlive(status: string, periodEnd: string | null, graceDays: number): boolean {
  if (["active", "trialing"].includes(status)) return true;
  return (
    status === "past_due" &&
    periodEnd !== null &&
    Date.now() <= new Date(periodEnd).getTime() + graceDays * 86400000
  );
}

/**
 * Mirrors has_group_subscription() / the booking entitlement for reads.
 * Bookings enforce the SQL functions server-side; this powers screens. A
 * household can hold a group plan and a private plan at the same time.
 */
export async function getSubscriptionSummary(
  supabase: SupabaseClient<Database>,
  clientId: string,
  graceDays = 7
): Promise<SubscriptionSummary> {
  const [{ data: subs }, { data: ledger }, { data: credits }, { data: usedCredits }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "status,current_period_end,cancel_at_period_end,created_at,plans(id,name,group_sessions_per_week,private_minutes_per_cycle,private_sessions_per_week,private_session_minutes)"
      )
      .eq("client_id", clientId)
      .in("status", ["active", "trialing", "past_due"])
      .order("created_at", { ascending: false }),
    supabase
      .from("private_credit_ledger")
      .select("delta_minutes")
      .eq("client_id", clientId),
    supabase
      .from("class_credits")
      .select("type,player_id")
      .eq("client_id", clientId)
      .is("consumed_at", null),
    supabase
      .from("class_credits")
      .select("type,player_id")
      .eq("client_id", clientId)
      .eq("type", "group_trial")
      .not("consumed_at", "is", null),
  ]);

  const minutesBalance = (ledger ?? []).reduce(
    (sum, row) => sum + row.delta_minutes,
    0
  );

  const toPlanSummary = (row: SubRow): PlanSummary | null => {
    const plan = row.plans;
    if (!plan) return null;
    return {
      planId: plan.id,
      planName: plan.name,
      status: row.status,
      periodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      groupSessionsPerWeek: plan.group_sessions_per_week,
      privateMinutesPerCycle: plan.private_minutes_per_cycle,
      privateSessionsPerWeek: plan.private_sessions_per_week,
      privateSessionMinutes: plan.private_session_minutes,
      active: isAlive(row.status, row.current_period_end, graceDays),
    };
  };

  let groupPlan: PlanSummary | null = null;
  let privatePlan: PlanSummary | null = null;
  for (const row of (subs ?? [])) {
    const summary = toPlanSummary(row);
    if (!summary) continue;
    const isGroup =
      summary.groupSessionsPerWeek === null || summary.groupSessionsPerWeek > 0;
    if (isGroup && !groupPlan) groupPlan = summary;
    if (!isGroup && !privatePlan) privatePlan = summary;
  }

  const openTrialPlayerIds = (credits ?? [])
    .filter((c) => c.type === "group_trial" && c.player_id)
    .map((c) => c.player_id as string);
  const hasAccountTrial = (credits ?? []).some(
    (c) => c.type === "group_trial" && !c.player_id
  );
  const usedTrialPlayerIds = (usedCredits ?? [])
    .filter((c) => c.player_id)
    .map((c) => c.player_id as string);
  const accountTrialUsed = (usedCredits ?? []).some((c) => !c.player_id);
  const dropinCredits = (credits ?? []).filter(
    (c) => c.type === "group_dropin"
  ).length;

  const primary = groupPlan ?? privatePlan;
  return {
    groupPlan,
    privatePlan,
    minutesBalance,
    openTrialPlayerIds,
    usedTrialPlayerIds,
    hasAccountTrial,
    accountTrialUsed,
    dropinCredits,
    active: Boolean(groupPlan?.active || privatePlan?.active),
    status: primary?.status ?? null,
    planName: primary?.planName ?? null,
    planId: primary?.planId ?? null,
    periodEnd: primary?.periodEnd ?? null,
    cancelAtPeriodEnd: primary?.cancelAtPeriodEnd ?? false,
  };
}

export function formatRenewalDate(iso: string | null): string {
  return iso ? formatDate(iso) : "—";
}
