/**
 * Live seeding via Supabase REST (anon key).
 * Idempotent: fixed UUIDs + PK upserts; sessions checked before insert.
 * Auth users are created via the public signup API where rate limits allow;
 * everything that doesn't need an auth user is always seeded.
 *
 * Usage: node scripts/seed-live.mjs
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY?.startsWith("ey") || env.SUPABASE_SERVICE_ROLE_KEY?.startsWith("sb_secret")
  ? env.SUPABASE_SERVICE_ROLE_KEY
  : env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SEED_EMAIL_BASE = "aa5925";
const SEED_EMAIL_DOMAIN = "ic.ac.uk";

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function upsert(table, rows, conflict = "id") {
  const res = await fetch(
    `${URL_}/rest/v1/${table}?on_conflict=${conflict}`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) console.error(`upsert ${table}:`, res.status, await res.text());
  else console.log(`upsert ${table}: ok (${rows.length})`);
  return res.ok;
}

async function select(table, query) {
  const res = await fetch(`${URL_}/rest/v1/${table}?${query}`, { headers });
  if (!res.ok) return [];
  return res.json();
}

async function signup(tag, fullName) {
  const email = `${SEED_EMAIL_BASE}+${tag}@${SEED_EMAIL_DOMAIN}`;
  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password: "SeedPass!2026x",
      data: { full_name: fullName },
    }),
  });
  const body = await res.json();
  if (res.ok && body.id) {
    console.log(`signup ${tag}: ${body.id}`);
    return body.id;
  }
  console.warn(`signup ${tag} failed:`, body.msg ?? body.error_description ?? res.status);
  return null;
}

// ── fixed ids ────────────────────────────────────────────────────────────────
const FOUNDER_ID = "4d4185d8-3937-4c25-9c60-e0d4c602e921"; // created earlier
const V = {
  lakefront: "00000000-0000-4000-8000-0000000001c1",
  palmRetreat: "00000000-0000-4000-8000-0000000001c2",
  laPalazzo: "00000000-0000-4000-8000-0000000001c3",
  espana: "00000000-0000-4000-8000-0000000001c4",
  stJohnsWood: "00000000-0000-4000-8000-0000000001c5",
};
const P = {
  group: "00000000-0000-4000-8000-0000000000d1",
  groupPlus: "00000000-0000-4000-8000-0000000000d2",
  privatePlan: "00000000-0000-4000-8000-0000000000d3",
};
const C = {
  lakefrontJuniors: "00000000-0000-4000-8000-0000000001f1",
  palmRetreatJuniors: "00000000-0000-4000-8000-0000000001f2",
  palmRetreatIntermediate: "00000000-0000-4000-8000-0000000001f3",
  laPalazzoMorning: "00000000-0000-4000-8000-0000000001f4",
  laPalazzoJuniorsA: "00000000-0000-4000-8000-0000000001f5",
  laPalazzoJuniorsB: "00000000-0000-4000-8000-0000000001f6",
  espanaJuniors: "00000000-0000-4000-8000-0000000001f7",
  stJohnsWoodJuniorsA: "00000000-0000-4000-8000-0000000001f8",
  stJohnsWoodJuniorsB: "00000000-0000-4000-8000-0000000001f9",
};

// ── founder ──────────────────────────────────────────────────────────────────
await upsert("profiles", [
  { id: FOUNDER_ID, role: "founder", full_name: "Founder", email: `${SEED_EMAIL_BASE}+seedfounder@${SEED_EMAIL_DOMAIN}` },
]);

// ── coaches (attempt signups; tolerate email rate limits) ───────────────────
const coachSpecs = [
  { tag: "coach-samir", name: "Samir", bio: "Former state number one. Calm, technical, relentless about footwork.", lat: 12.9352, lng: 77.6902, radius: 12, level: "elite", dbs: true, tier: 3 },
  { tag: "coach-nandan", name: "Nandan", bio: "Attack-first coach. Loves teaching the third-ball game.", lat: 12.911, lng: 77.667, radius: 15, level: "advanced", dbs: true, tier: 2 },
  { tag: "coach-sunil", name: "Sunil", bio: "Junior development specialist — patient and precise.", lat: 12.929, lng: 77.6014, radius: 8, level: "advanced", dbs: false, tier: 1 },
];

const coachIds = [];
for (const spec of coachSpecs) {
  // reuse an existing profile if a prior run created it
  const existing = await select(
    "profiles",
    `email=eq.${SEED_EMAIL_BASE}%2B${spec.tag}@${SEED_EMAIL_DOMAIN}&select=id`
  );
  const id = existing[0]?.id ?? (await signup(spec.tag, spec.name));
  if (!id) continue;
  coachIds.push({ id, ...spec });
  await upsert("profiles", [
    { id, role: "coach", full_name: spec.name, email: `${SEED_EMAIL_BASE}+${spec.tag}@${SEED_EMAIL_DOMAIN}`, avatar_url: `/images/coach-${spec.name.toLowerCase()}.jpg` },
  ]);
  await upsert("coaches", [
    { id, bio: spec.bio, base_lat: spec.lat, base_lng: spec.lng, travel_radius_km: spec.radius, max_teachable_level: spec.level, dbs_checked: spec.dbs, tier: spec.tier },
  ]);
  const avail = [];
  for (let wd = 0; wd <= 5; wd++)
    avail.push({ coach_id: id, weekday: wd, start_time: "07:30", end_time: "21:30" });
  const have = await select("coach_availability", `coach_id=eq.${id}&select=id`);
  if (have.length === 0) await upsert("coach_availability", avail);
}

// ── venues / plans / settings ───────────────────────────────────────────────
await upsert("venues", [
  { id: V.lakefront, name: "Adarsh Palm Retreat Lakefront", address: "Adarsh Palm Retreat Lakefront, Outer Ring Rd, next to Intel, Devarabisanahalli, Bellandur, Bengaluru, Karnataka", postcode: "560103", lat: 12.9352, lng: 77.6902, photo_url: "/images/venue-hall.jpg" },
  { id: V.palmRetreat, name: "Adarsh Palm Retreat", address: "Adarsh Palm Retreat, Bellandur, Bengaluru, Karnataka", postcode: "560103", lat: 12.9268, lng: 77.681, photo_url: "/images/venue-hall.jpg" },
  { id: V.laPalazzo, name: "La Palazzo", address: "KMB La Palazzo, Sarjapur Rd, Ambalipura, HSR Layout, Bengaluru, Karnataka", postcode: "560102", lat: 12.911, lng: 77.667, photo_url: "/images/venue-hall.jpg" },
  { id: V.espana, name: "Mantri Espana", address: "Mantri Espana, Kariyammana Agrahara, Bellandur, Bengaluru, Karnataka", postcode: "560103", lat: 12.9385, lng: 77.6946, photo_url: "/images/venue-hall.jpg" },
  { id: V.stJohnsWood, name: "Prestige St. John's Wood", address: "Prestige St. John's Wood, Tavarekere Main Rd, S.G. Palya, Bengaluru, Karnataka", postcode: "560029", lat: 12.929, lng: 77.6014, photo_url: "/images/venue-hall.jpg" },
]);

await upsert("plans", [
  // price_pence holds paise (minor unit of INR): ₹18,000 = 1,800,000.
  { id: P.group, name: "Group", description: "Up to 2 group sessions a week.", price_pence: 1800000, currency: "inr", group_sessions_per_week: 2, private_minutes_per_quarter: 0 },
  { id: P.groupPlus, name: "Group+", description: "Unlimited group sessions.", price_pence: 2600000, currency: "inr", group_sessions_per_week: null, private_minutes_per_quarter: 0 },
  { id: P.privatePlan, name: "Private", description: "Unlimited group sessions plus 240 private minutes a quarter.", price_pence: 4200000, currency: "inr", group_sessions_per_week: null, private_minutes_per_quarter: 240 },
]);

await upsert(
  "settings",
  [
    { key: "assignment_weights", value: { continuity: 35, proximity: 25, load: 20, adjacency: 15, seniority: 5 } },
    { key: "cancellation_window_hours", value: 24 },
    { key: "booking_cutoff_minutes", value: 60 },
    { key: "travel_buffer_minutes", value: 30 },
    { key: "reschedule_max_hops", value: 2 },
    { key: "dunning_grace_days", value: 7 },
    { key: "waitlist_claim_minutes", value: 15 },
  ],
  "key"
);

// ── classes ─────────────────────────────────────────────────────────────────
const coachFor = (i) => coachIds[i % Math.max(coachIds.length, 1)]?.id ?? null;

const today10 = () => new Date().toISOString().slice(0, 10);
await upsert("classes", [
  { id: C.lakefrontJuniors, class_type: "group", title: "Juniors — Lakefront", description: "Ages 6–14. Fundamentals, footwork and fast rallies by the lake.", skill_level: "beginner", capacity: 12, duration_minutes: 60, venue_id: V.lakefront, recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,FR", starts_on: today10(), created_by: FOUNDER_ID },
  { id: C.palmRetreatJuniors, class_type: "group", title: "Juniors — Palm Retreat", description: "Ages 6–14. Grip, stance and your first hundred rallies.", skill_level: "beginner", capacity: 12, duration_minutes: 60, venue_id: V.palmRetreat, recurrence_rule: "FREQ=WEEKLY;BYDAY=TU,TH", starts_on: today10(), created_by: FOUNDER_ID },
  { id: C.palmRetreatIntermediate, class_type: "group", title: "Intermediate — Palm Retreat", description: "Serve variations, loop mechanics and third-ball patterns after work.", skill_level: "intermediate", capacity: 10, duration_minutes: 60, venue_id: V.palmRetreat, recurrence_rule: "FREQ=WEEKLY;BYDAY=TU,TH", starts_on: today10(), created_by: FOUNDER_ID },
  { id: C.laPalazzoMorning, class_type: "group", title: "Morning Adults — La Palazzo", description: "Start the day at the table — drills, rallies and match play before work.", skill_level: "intermediate", capacity: 10, duration_minutes: 60, venue_id: V.laPalazzo, recurrence_rule: "FREQ=WEEKLY;BYDAY=TU,TH", starts_on: today10(), created_by: FOUNDER_ID },
  { id: C.laPalazzoJuniorsA, class_type: "group", title: "Juniors A — La Palazzo", description: "Ages 6–14. Early-evening group — fundamentals and footwork.", skill_level: "beginner", capacity: 12, duration_minutes: 60, venue_id: V.laPalazzo, recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU", starts_on: today10(), created_by: FOUNDER_ID },
  { id: C.laPalazzoJuniorsB, class_type: "group", title: "Juniors B — La Palazzo", description: "Ages 6–14. Later group — consistency, spin and match play.", skill_level: "beginner", capacity: 12, duration_minutes: 60, venue_id: V.laPalazzo, recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU", starts_on: today10(), created_by: FOUNDER_ID },
  { id: C.espanaJuniors, class_type: "group", title: "Juniors — Espana", description: "Ages 6–14. After-school fundamentals, midweek and weekend.", skill_level: "beginner", capacity: 12, duration_minutes: 60, venue_id: V.espana, recurrence_rule: "FREQ=WEEKLY;BYDAY=WE,SA", starts_on: today10(), created_by: FOUNDER_ID },
  { id: C.stJohnsWoodJuniorsA, class_type: "group", title: "Juniors A — St. John's Wood", description: "Ages 6–14. Thursday development group — technique and rallies.", skill_level: "beginner", capacity: 12, duration_minutes: 60, venue_id: V.stJohnsWood, recurrence_rule: "FREQ=WEEKLY;BYDAY=TH", starts_on: today10(), created_by: FOUNDER_ID },
  { id: C.stJohnsWoodJuniorsB, class_type: "group", title: "Juniors B — St. John's Wood", description: "Ages 6–14. Thursday second group — technique and match play.", skill_level: "beginner", capacity: 12, duration_minutes: 60, venue_id: V.stJohnsWood, recurrence_rule: "FREQ=WEEKLY;BYDAY=TH", starts_on: today10(), created_by: FOUNDER_ID },
]);

// ── sessions: 4 weeks ahead, Asia/Kolkata wall clock ────────────────────────
// weekdays are ISO (1=Mon..7=Sun)
const specs = [
  { classId: C.lakefrontJuniors, weekdays: [1, 5], time: "17:00", mins: 60, coach: coachFor(0) },
  { classId: C.palmRetreatJuniors, weekdays: [2, 4], time: "16:00", mins: 60, coach: coachFor(1) },
  { classId: C.palmRetreatIntermediate, weekdays: [2, 4], time: "20:00", mins: 60, coach: coachFor(0) },
  { classId: C.laPalazzoMorning, weekdays: [2, 4], time: "08:00", mins: 60, coach: coachFor(1) },
  { classId: C.laPalazzoJuniorsA, weekdays: [1, 2], time: "18:00", mins: 60, coach: coachFor(1) },
  { classId: C.laPalazzoJuniorsB, weekdays: [1, 2], time: "19:00", mins: 60, coach: coachFor(1) },
  { classId: C.espanaJuniors, weekdays: [3, 6], time: "16:30", mins: 60, coach: coachFor(0) },
  { classId: C.stJohnsWoodJuniorsA, weekdays: [4], time: "18:00", mins: 60, coach: coachFor(2) },
  { classId: C.stJohnsWoodJuniorsB, weekdays: [4], time: "19:15", mins: 60, coach: coachFor(2) },
];

// Academy timezone offset for a given date (IST is a fixed +05:30 — minutes matter)
function academyOffsetMinutes(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", timeZoneName: "shortOffset" });
  const part = fmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = part.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}

const sessions = [];
const today = new Date();
for (const s of specs) {
  const existing = await select("class_sessions", `class_id=eq.${s.classId}&select=starts_at`);
  const existingSet = new Set(existing.map((r) => new Date(r.starts_at).getTime()));
  for (let d = 0; d <= 28; d++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
    const isoDow = ((day.getDay() + 6) % 7) + 1; // 1=Mon..7=Sun
    if (!s.weekdays.includes(isoDow)) continue;
    const [hh, mm] = s.time.split(":").map(Number);
    const naive = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm));
    const startsAt = new Date(naive.getTime() - academyOffsetMinutes(naive) * 60000);
    if (startsAt <= new Date()) continue;
    if (existingSet.has(startsAt.getTime())) continue;
    sessions.push({
      class_id: s.classId,
      coach_id: s.coach,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + s.mins * 60000).toISOString(),
    });
  }
}
if (sessions.length) {
  const res = await fetch(`${URL_}/rest/v1/class_sessions`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(sessions),
  });
  console.log("insert class_sessions:", res.ok ? `ok (${sessions.length})` : `${res.status} ${await res.text()}`);
} else {
  console.log("class_sessions: nothing new to insert");
}

// ── demo client with comp subscription ──────────────────────────────────────
const demoExisting = await select(
  "profiles",
  `email=eq.${SEED_EMAIL_BASE}%2Bdemo-client@${SEED_EMAIL_DOMAIN}&select=id`
);
const demoId = demoExisting[0]?.id ?? (await signup("demo-client", "Alex Morgan"));
if (demoId) {
  await upsert("profiles", [
    { id: demoId, role: "client", full_name: "Alex Morgan", email: `${SEED_EMAIL_BASE}+demo-client@${SEED_EMAIL_DOMAIN}` },
  ]);
  const players = await select("players", `client_id=eq.${demoId}&select=id`);
  if (players.length === 0) {
    await upsert("players", [{ id: "00000000-0000-4000-8000-0000000000b1", client_id: demoId, full_name: "Alex Morgan", date_of_birth: "1992-04-12", skill_level: "intermediate" }]);
  }
  await upsert("subscriptions", [
    { id: "00000000-0000-4000-8000-0000000000e1", client_id: demoId, plan_id: P.privatePlan, source: "comp", status: "active", current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 90 * 86400000).toISOString() },
  ]);
  const ledger = await select("private_credit_ledger", `client_id=eq.${demoId}&select=id`);
  if (ledger.length === 0) {
    await upsert("private_credit_ledger", [
      { id: "00000000-0000-4000-8000-0000000000e3", client_id: demoId, subscription_id: "00000000-0000-4000-8000-0000000000e1", delta_minutes: 240, reason: "grant" },
    ]);
  }
}

console.log("Seed complete.");
