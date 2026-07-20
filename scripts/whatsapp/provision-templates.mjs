/**
 * Create (and submit for WhatsApp approval) the interactive Content templates
 * the academy sends coaches — the 1-hour-before class reminder with quick-reply
 * buttons, and the after-class summary. Idempotent: re-running reuses a template
 * that already exists with the same friendly_name.
 *
 * The button `id`s here MUST stay in sync with lib/whatsapp/interactive.ts.
 *
 * Requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN in .env.local.
 * Usage: node scripts/whatsapp/provision-templates.mjs
 *
 * After approval (check the Twilio Console → Messaging → Content Template
 * Builder), set the printed SIDs on the Supabase edge function:
 *   supabase secrets set \
 *     TWILIO_WA_COACH_REMINDER_SID=HX... \
 *     TWILIO_WA_COACH_AFTERCLASS_SID=HX...
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const SID = env.TWILIO_ACCOUNT_SID;
const TOKEN = env.TWILIO_AUTH_TOKEN;
if (!SID || !TOKEN) {
  console.error("Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.local first.");
  process.exit(1);
}
const auth = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");

async function api(method, path, body) {
  const res = await fetch(`https://content.twilio.com${path}`, {
    method,
    headers: {
      Authorization: auth,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

/** Find an existing Content template by friendly_name, paging as needed. */
async function findByName(name) {
  let url = "/v1/Content?PageSize=50";
  for (let i = 0; i < 40 && url; i++) {
    const { ok, json } = await api("GET", url);
    if (!ok) break;
    const hit = (json.contents ?? []).find((c) => c.friendly_name === name);
    if (hit) return hit.sid;
    url = json.meta?.next_page_url ? json.meta.next_page_url.replace("https://content.twilio.com", "") : null;
  }
  return null;
}

async function ensureTemplate(def) {
  const existing = await findByName(def.friendly_name);
  if (existing) {
    console.log(`• ${def.friendly_name}: already exists (${existing})`);
    return existing;
  }
  const { ok, status, json } = await api("POST", "/v1/Content", def);
  if (!ok) {
    console.error(`✗ ${def.friendly_name}: create failed (${status})`, json);
    return null;
  }
  console.log(`✓ ${def.friendly_name}: created (${json.sid})`);
  return json.sid;
}

/** Submit the template for WhatsApp approval as a UTILITY template. */
async function requestApproval(sid, name) {
  const { ok, status, json } = await api(
    "POST",
    `/v1/Content/${sid}/ApprovalRequests/whatsapp`,
    { name, category: "UTILITY" }
  );
  if (ok) {
    console.log(`  ↳ approval submitted (${json.whatsapp?.status ?? "received"})`);
  } else if (status === 409 || /already/i.test(JSON.stringify(json))) {
    console.log("  ↳ approval already requested");
  } else {
    console.error(`  ↳ approval request failed (${status})`, json);
  }
}

const TEMPLATES = [
  {
    key: "TWILIO_WA_COACH_REMINDER_SID",
    approvalName: "coach_class_reminder",
    def: {
      friendly_name: "coach_class_reminder",
      language: "en",
      variables: { 1: "Augustine", 2: "Beginners Batch", 3: "6:30 pm", 4: " at La Plazza" },
      types: {
        "twilio/quick-reply": {
          body:
            "Hi {{1}} 👋 Reminder: your class *{{2}}* starts at {{3}}{{4}}. Tap below to keep us posted — see you on court!",
          actions: [
            { title: "I'm coming", id: "coach_confirm" },
            { title: "I've arrived", id: "coach_arrived" },
            { title: "Running late", id: "coach_late" },
          ],
        },
        "twilio/text": {
          body:
            'Hi {{1}}! Reminder: {{2}} starts at {{3}}{{4}}. Reply "coming", "arrived", or "running late" to keep us posted.',
        },
      },
    },
  },
  {
    key: "TWILIO_WA_COACH_AFTERCLASS_SID",
    approvalName: "coach_class_complete",
    def: {
      friendly_name: "coach_class_complete",
      language: "en",
      variables: {
        1: "Beginners Batch",
        2: "Up next today: Improvers at 7:30 pm.",
        3: "https://sharwinacademy.com/coach/session/0000",
      },
      types: {
        "twilio/quick-reply": {
          body:
            "🎉 Great work wrapping up *{{1}}*! {{2}} Please confirm today's attendance and add a quick assessment note for each student here: {{3}}",
          actions: [
            { title: "All present ✅", id: "ac_present" },
            { title: "Some absent", id: "ac_absent" },
          ],
        },
        "twilio/text": {
          body: "Great work finishing {{1}}! {{2}} Confirm attendance & add notes: {{3}}",
        },
      },
    },
  },
];

const results = {};
for (const t of TEMPLATES) {
  const sid = await ensureTemplate(t.def);
  if (sid) {
    await requestApproval(sid, t.approvalName);
    results[t.key] = sid;
  }
}

console.log("\nSet these on the Supabase edge function once approved:\n");
for (const [key, sid] of Object.entries(results)) {
  console.log(`  ${key}=${sid}`);
}
console.log(
  "\n  supabase secrets set " +
    Object.entries(results)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ") +
    "\n\nApproval is asynchronous — track it in the Twilio Console. Until the SIDs" +
    "\nare set the coach prompts still send as plain text (and typed replies like" +
    '\n"arrived" work too).'
);
