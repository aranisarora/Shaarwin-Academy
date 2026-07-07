/**
 * One-off: create a Razorpay Plan for each academy plan missing a
 * razorpay_plan_id, storing the id back on the plans table. Quarterly INR
 * (period=monthly, interval=3). price_pence holds paise.
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
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
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
    console.log(`${plan.name}: already linked (${plan.razorpay_plan_id})`);
    continue;
  }
  const created = await rzp("/plans", {
    period: "monthly",
    interval: 3, // quarterly
    item: {
      name: `Sharwin TTA — ${plan.name}`,
      description: plan.description ?? undefined,
      amount: plan.price_pence, // paise
      currency: "INR",
    },
    notes: { plan_id: plan.id },
  });
  await db.from("plans").update({ razorpay_plan_id: created.id }).eq("id", plan.id);
  console.log(`${plan.name}: created ${created.id}`);
}
console.log("Razorpay setup complete.");
