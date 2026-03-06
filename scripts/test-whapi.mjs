/**
 * Whapi integration smoke tests — run with:
 *   node --env-file=.env.local scripts/test-whapi.mjs
 */

const BASE_URL = "https://gate.whapi.cloud";
const TOKEN = process.env.WHAPI_TOKEN;

if (!TOKEN) {
  console.error("❌  WHAPI_TOKEN not set");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── 1. Payload structure validation ──────────────────────────────────────────

console.log("\n📋  Payload structure checks");

function buildInteractivePayload(to, body, buttonText, url) {
  return {
    to: to.replace(/^\+/, ""),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `${body}\n\n${url}` },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: "open_dashboard",
              title: buttonText.slice(0, 20),
            },
          },
        ],
      },
    },
  };
}

const payload = buildInteractivePayload(
  "+919845064704",
  "Hi Test! Your booking is confirmed.",
  "Manage Booking",
  "https://example.com/dashboard"
);

assert("to strips leading '+'", !payload.to.startsWith("+"));
assert("top-level type === 'interactive'", payload.type === "interactive");
assert("interactive.type === 'button'", payload.interactive.type === "button");
assert("interactive.body exists", typeof payload.interactive.body?.text === "string");
assert("body.text under 1024 chars", payload.interactive.body.text.length <= 1024, `length=${payload.interactive.body.text.length}`);
assert("action.buttons is array", Array.isArray(payload.interactive.action?.buttons));
assert("max 3 buttons", payload.interactive.action.buttons.length <= 3);

for (const btn of payload.interactive.action.buttons) {
  assert(`button type === 'reply'`, btn.type === "reply");
  assert(`button.reply.id present`, !!btn.reply?.id);
  assert(`button title ≤ 20 chars`, btn.reply?.title?.length <= 20, `title="${btn.reply?.title}"`);
}

// ── 2. Live connectivity ───────────────────────────────────────────────────

console.log("\n🌐  Live connectivity check");

try {
  const res = await fetch(`${BASE_URL}/health`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert(`Whapi /health reachable (${res.status})`, res.status < 500);

  const text = await res.text();
  console.log(`     Response: ${text.slice(0, 120)}`);
} catch (e) {
  console.error(`  ❌  Network error: ${e.message}`);
  failed++;
}

// ── 3. Summary ────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
