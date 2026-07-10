import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getRazorpay } from "@/lib/razorpay";

/**
 * One-off purchases (group drop-in, private hours, intro promo): authenticated
 * client + product_id → Razorpay Order. Prices are looked up server-side —
 * group members get member_price_pence. Fulfilment (credit / minutes grant)
 * happens in the webhook on payment.captured, keyed off our orders table.
 */

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

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

  const { product_id, player_id } = (await request.json()) as {
    product_id?: string;
    player_id?: string;
  };
  if (!product_id) {
    return NextResponse.json({ error: "product_required" }, { status: 400 });
  }

  const { data: product } = await supabase
    .from("products")
    .select("id,name,kind,price_pence,member_price_pence")
    .eq("id", product_id)
    .eq("active", true)
    .maybeSingle();
  if (!product) {
    return NextResponse.json({ error: "product_not_available" }, { status: 400 });
  }

  // The player must belong to this account when specified; the intro promo is
  // per-child so it always needs one.
  if (product.kind === "private_intro" && !player_id) {
    return NextResponse.json({ error: "player_required" }, { status: 400 });
  }
  if (player_id) {
    const { data: player } = await supabase
      .from("players")
      .select("id")
      .eq("id", player_id)
      .eq("client_id", user.id)
      .maybeSingle();
    if (!player) {
      return NextResponse.json({ error: "player_not_in_household" }, { status: 400 });
    }
  }

  const db = admin();

  // Intro promo: once per child, ever.
  if (product.kind === "private_intro") {
    const { data: prior } = await db
      .from("orders")
      .select("id, products!inner(kind)")
      .eq("player_id", player_id!)
      .eq("status", "paid")
      .eq("products.kind", "private_intro")
      .limit(1);
    if (prior && prior.length > 0) {
      return NextResponse.json({ error: "intro_already_used" }, { status: 400 });
    }
  }

  // Member pricing: an active group membership earns member_price_pence.
  const { data: isMember } = await supabase.rpc("has_group_subscription", {
    p_client: user.id,
  });
  const amount =
    isMember && product.member_price_pence !== null
      ? product.member_price_pence
      : product.price_pence;

  const { data: profile } = await supabase
    .from("profiles")
    .select("email,full_name")
    .eq("id", user.id)
    .single();

  try {
    const order = await razorpay.post<{ id: string }>("/orders", {
      amount,
      currency: "INR",
      notes: {
        supabase_user_id: user.id,
        product_id: product.id,
        player_id: player_id ?? "",
      },
    });

    const { error: insertError } = await db.from("orders").insert({
      client_id: user.id,
      player_id: player_id ?? null,
      product_id: product.id,
      razorpay_order_id: order.id,
      amount_pence: amount,
      currency: "inr",
      status: "created",
    });
    if (insertError) throw insertError;

    return NextResponse.json({
      order_id: order.id,
      amount,
      key_id: razorpay.keyId,
      product_name: product.name,
      prefill: {
        name: profile?.full_name ?? "",
        email: profile?.email ?? user.email ?? "",
      },
    });
  } catch (err) {
    console.error("razorpay order create failed", err);
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}
