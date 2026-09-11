#!/usr/bin/env node
/**
 * Freeze the academy's public reference data into content/academy.json.
 *
 * The site no longer has a database. Venues, coaches, plans and products used
 * to be read from Supabase on every ISR revalidation; they change a handful of
 * times a year, so they are now a checked-in JSON file that this script
 * regenerates on demand — the only thing in the repo that still talks to
 * Sharwin's Supabase project, and it only ever reads.
 *
 * Usage:  node scripts/export-content.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY out of
 * .env.local by hand (no dotenv dependency). READ-ONLY: every statement below
 * is a select or an RPC read. Never add a write here.
 *
 * Photos: a photo_url that is already a site-relative path ("/images/…") is
 * left alone — those files live in public/ and are committed. A remote URL
 * (Supabase Storage) is downloaded into
 * public/images/content/<venues|coaches>/<id>.<ext> and the JSON is rewritten
 * to that local path, so the built site never depends on Supabase being up.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_JSON = path.join(ROOT, "content", "academy.json");
const PUBLIC_DIR = path.join(ROOT, "public");

function readEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) {
    throw new Error(".env.local not found — it carries the read-only Supabase credentials.");
  }
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const EXT_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/gif": ".gif",
};

/**
 * @returns the path the site should render, or null. Local paths pass straight
 * through; remote ones are downloaded first.
 */
async function localisePhoto(url, kind, id) {
  if (!url) return null;
  if (url.startsWith("/")) {
    if (!existsSync(path.join(PUBLIC_DIR, url.replace(/^\//, "")))) {
      console.warn(`  ! ${kind}/${id}: ${url} is not in public/ — rendering will 404`);
    }
    return url;
  }
  if (!/^https?:\/\//.test(url)) {
    console.warn(`  ! ${kind}/${id}: unrecognised photo_url ${url} — dropped`);
    return null;
  }
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  ! ${kind}/${id}: photo download failed (${res.status}) — dropped`);
    return null;
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = EXT_BY_TYPE[type] ?? path.extname(new URL(url).pathname) ?? ".jpg";
  const rel = `/images/content/${kind}/${id}${ext}`;
  const dest = path.join(PUBLIC_DIR, rel.replace(/^\//, ""));
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  ↓ ${kind}/${id} → ${rel}`);
  return rel;
}

function must(label, { data, error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

async function main() {
  const env = readEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  }
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Venues ────────────────────────────────────────────────────────────────
  // Public and not a school campus: a school is not somewhere a member of the
  // public can turn up to.
  const venueRows = must(
    "venues",
    await sb
      .from("venues")
      .select("id,name,unit,address,postcode,lat,lng,notes,photo_url")
      .eq("is_public", true)
      .eq("is_school", false)
      .order("name")
  );
  console.log(`venues: ${venueRows.length}`);
  const venues = [];
  for (const v of venueRows) {
    venues.push({
      id: v.id,
      name: v.name,
      unit: v.unit ?? null,
      address: v.address,
      postcode: v.postcode,
      lat: v.lat,
      lng: v.lng,
      notes: v.notes ?? null,
      photo: await localisePhoto(v.photo_url, "venues", v.id),
    });
  }

  // ── Coaches ───────────────────────────────────────────────────────────────
  // public_coach_roster() is the definer-rights projection that joins coaches
  // to profiles (RLS keeps profiles owner-only). If it is ever dropped, fall
  // back to the two tables directly — the service role can read both.
  let coachRows;
  const rpc = await sb.rpc("public_coach_roster");
  if (rpc.error) {
    console.warn(`public_coach_roster() unavailable (${rpc.error.message}) — falling back to coaches + profiles`);
    const coaches = must(
      "coaches",
      await sb.from("coaches").select("id,bio,quote,credentials,photo_url").eq("active", true)
    );
    const profiles = must(
      "profiles",
      await sb.from("profiles").select("id,full_name").in("id", coaches.map((c) => c.id))
    );
    const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));
    coachRows = coaches.map((c) => ({ ...c, full_name: nameById.get(c.id) ?? "" }));
  } else {
    coachRows = rpc.data ?? [];
  }
  console.log(`coaches: ${coachRows.length}`);
  const coaches = [];
  for (const c of coachRows) {
    coaches.push({
      id: c.id,
      name: c.full_name ?? "",
      bio: c.bio ?? null,
      quote: c.quote ?? null,
      credentials: c.credentials ?? null,
      photo: await localisePhoto(c.photo_url, "coaches", c.id),
    });
  }

  // ── Plans and products ────────────────────────────────────────────────────
  const plans = must(
    "plans",
    await sb
      .from("plans")
      .select("name,description,price_pence,billing_interval_months,group_sessions_per_week,private_minutes_per_cycle")
      .eq("active", true)
      .order("price_pence")
  ).map((p) => ({
    name: p.name,
    description: p.description ?? null,
    price_pence: p.price_pence,
    billing_interval_months: p.billing_interval_months ?? null,
    group_sessions_per_week: p.group_sessions_per_week ?? null,
    private_minutes_per_cycle: p.private_minutes_per_cycle ?? 0,
  }));
  console.log(`plans: ${plans.length}`);

  const products = must(
    "products",
    await sb
      .from("products")
      .select("id,name,description,kind,price_pence,member_price_pence,grants_minutes,duration_minutes")
      .eq("active", true)
      .order("price_pence")
  ).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    kind: p.kind,
    price_pence: p.price_pence,
    member_price_pence: p.member_price_pence ?? null,
    grants_minutes: p.grants_minutes ?? 0,
    duration_minutes: p.duration_minutes ?? null,
  }));
  console.log(`products: ${products.length}`);

  mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  writeFileSync(
    OUT_JSON,
    JSON.stringify({ venues, coaches, plans, products }, null, 2) + "\n"
  );
  console.log(`wrote ${path.relative(ROOT, OUT_JSON)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
