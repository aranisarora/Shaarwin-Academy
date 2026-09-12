import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRazorpay } from "@/lib/razorpay";

/**
 * Cancel one of the caller's active Razorpay subscriptions at the end of the
 * paid cycle (cancel_at_cycle_end=1). A household can hold a group plan and a
 * private plan at once, so the body may pass plan_id to pick one; without it
 * the most recent subscription is cancelled. The webhook mirrors the
 * resulting state; we optimistically flag cancel_at_period_end so the UI
 * updates immediately.
 */
export async function POST(request: Request) {
  const razorpay = getRazorpay();
  if (!razorpay) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { plan_id } = (await request.json().catch(() => ({}))) as {
    plan_id?: string;
  };

  let query = supabase
    .from("subscriptions")
    .select("id,razorpay_subscription_id,source,status")
    .eq("client_id", user.id)
    .eq("source", "razorpay")
    .in("status", ["active", "past_due", "trialing"]);
  if (plan_id) query = query.eq("plan_id", plan_id);

  const { data: sub } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub?.razorpay_subscription_id) {
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  try {
    await razorpay.post(`/subscriptions/${sub.razorpay_subscription_id}/cancel`, {
      cancel_at_cycle_end: 1,
    });
  } catch (err) {
    console.error("razorpay cancel failed", err);
    return NextResponse.json({ error: "cancel_failed" }, { status: 502 });
  }

  await supabase
    .from("subscriptions")
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq("id", sub.id);

  return NextResponse.json({ ok: true });
}
