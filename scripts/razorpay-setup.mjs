/**
 * Sync Razorpay Plans with the academy plans table. For each active plan:
 * create a Razorpay Plan if it has none, or — since Razorpay Plans are
 * immutable — re-create and relink it when the DB price_pence no longer
 * matches the linked plan's amount (price drift). Idempotent: safe to re-run
 * after any price change. Monthly INR — every plan stays under the ₹15,000
 * e-mandate AFA limit so renewals debit silently. price_pence holds paise.
 *
 * Requires RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET and (ideally)
 * SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Usage: node scripts/razorpay-setup.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
  console.error("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.local first.");
  process.exit(1);
}

const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");
async function rzp(path, body) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

// Razorpay Plans are immutable: their amount is fixed at creation. When a
// plan's price_pence changes in the DB the linked Razorpay plan keeps the old
// amount and keeps charging it, so we can't just skip already-linked plans —
// we must verify the amount and re-create (relink) on drift.
async function createPlan(plan) {
  return rzp("/plans", {
    period: "monthly",
    interval: 1,
    item: {
      name: `Sharwin TTA — ${plan.name}`,
      description: plan.description ?? undefined,
      amount: plan.price_pence, // paise
      currency: "INR",
    },
    notes: { plan_id: plan.id },
  });
}

const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY?.length > 40
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const { data: plans, error } = await db.from("plans").select("*").eq("active", true);
if (error) throw error;

for (const plan of plans) {
  if (plan.razorpay_plan_id) {
    // Verify the linked plan still charges the DB price; relink if it drifted.
    const existing = await rzp(`/plans/${plan.razorpay_plan_id}`);
    if (existing.item.amount === plan.price_pence) {
      console.log(`${plan.name}: already linked, price OK (${plan.razorpay_plan_id})`);
      continue;
    }
    const created = await createPlan(plan);
    await db.from("plans").update({ razorpay_plan_id: created.id }).eq("id", plan.id);
    console.log(
      `${plan.name}: price drift ${existing.item.amount} -> ${plan.price_pence}, relinked ${plan.razorpay_plan_id} -> ${created.id}`
    );
    continue;
  }
  const created = await createPlan(plan);
  await db.from("plans").update({ razorpay_plan_id: created.id }).eq("id", plan.id);
  console.log(`${plan.name}: created ${created.id}`);
}
console.log("Razorpay setup complete.");
