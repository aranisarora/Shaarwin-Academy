import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRazorpay } from "@/lib/razorpay";

/**
 * Authenticated client + plan_id → Razorpay Subscription (quarterly). Returns
 * the subscription id + public key; the browser opens Razorpay Checkout with
 * it. Activation is confirmed by the webhook, not this response.
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
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { plan_id } = (await request.json()) as { plan_id?: string };
  if (!plan_id) {
    return NextResponse.json({ error: "plan_required" }, { status: 400 });
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("id,name,razorpay_plan_id")
    .eq("id", plan_id)
    .eq("active", true)
    .maybeSingle();
  if (!plan?.razorpay_plan_id) {
    return NextResponse.json({ error: "plan_not_available" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email,full_name")
    .eq("id", user.id)
    .single();

  try {
    // total_count = billing cycles before the subscription completes. 40 quarters
    // (~10 years) is effectively "until cancelled" for a membership.
    const subscription = await razorpay.post<{ id: string; status: string }>(
      "/subscriptions",
      {
        plan_id: plan.razorpay_plan_id,
        total_count: 40,
        quantity: 1,
        customer_notify: 1,
        notes: {
          supabase_user_id: user.id,
          plan_id: plan.id,
          email: profile?.email ?? user.email ?? "",
          full_name: profile?.full_name ?? "",
        },
      }
    );

    return NextResponse.json({
      subscription_id: subscription.id,
      key_id: razorpay.keyId,
      plan_name: plan.name,
      prefill: {
        name: profile?.full_name ?? "",
        email: profile?.email ?? user.email ?? "",
      },
    });
  } catch (err) {
    console.error("razorpay subscription create failed", err);
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}
