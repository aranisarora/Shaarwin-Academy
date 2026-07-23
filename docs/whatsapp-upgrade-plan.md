# WhatsApp upgrade — implementation plan

Status: planned, not implemented. Execute **after** `docs/skills-rework-plan.md`.
This document is decision-complete: follow it as written. Written against commit `bad4852` on `main`.

## Read first (non-negotiable)

- `AGENTS.md`: this Next.js version has breaking changes vs. training data. Copy existing in-repo patterns rather than writing from memory.
- `supabase/schema.sql` is the canonical schema. Several parts below say "grep the schema for the exact RPC/enum" — do that, don't guess.
- DB changes go through the Supabase MCP (`apply_migration`, project ref `jkjgdpifimvnptpxjixk`), then regenerate `supabase/schema.sql` via MCP and commit both together (pre-commit hook enforces this). Use the next free migration number (skills rework takes `0035`, so start at `0036`).
- The delivery worker is a **Deno edge function** (`supabase/functions/notify/index.ts`). After editing it, deploy via MCP `deploy_edge_function`. It is not part of the Next build.
- Read `docs/whatsapp-interactive.md` and `lib/whatsapp/interactive.ts` before touching inbound handling — the coach button system already works and this plan extends it, not replaces it.

## Current state (verified)

- **Transport**: Twilio WhatsApp. `notify` edge function runs on a 1-min cron, delivers `notifications` rows WhatsApp-first (free-form inside the 24h service window, generic utility template `TWILIO_WA_TEMPLATE_SID` outside it, Resend email as last resort).
- **Interactive**: two coach quick-reply templates are already **created and submitted for Meta approval** (`coach_class_reminder` = `HXebc91b4097a32fa1fc4e70ff4adc4e3a`, `coach_class_complete` = `HX246b5a61ef0990b0c60dde14f16a3cd4`; the provisioning script is idempotent by friendly_name) — but the SIDs are **not yet set as edge-function secrets**, so coach prompts still go as plain text. "Buttons not showing" = approval/secrets pending, not a bug.
- **Inbound**: `app/api/whatsapp/route.ts` → deterministic coach button/word handler (`lib/whatsapp/interactive.ts`) → else the LLM assistant (`lib/whatsapp/agent.ts`, Gemini via Vertex, role-scoped tools).
- **Notification inventory**:
  - *Clients*: `booking_confirmed`, `reminder_24h`, `reminder_2h`, `booking_rescheduled`, `waitlist_spot`, `coach_assigned`, `coach_changed`, `coach_arrived`, `coach_late`, `session_cancelled`, `private_series_ended`, `private_minutes_low`, `payment_failed`.
  - *Coaches*: `coach_before_class`, `coach_after_class`, `new_private_session`, `coach_changed`, `session_cancelled`, `role_changed`, `time_off` outcome (verify it exists — if the founder's approve/deny action doesn't notify the coach, add it in Part 6).
  - *Founder*: escalations (`ops_coach_unconfirmed`, `ops_coach_not_arrived`, `session_unassigned`, `session_issue`, `private_request_parked`, `time_off_requested`, `ops_payment_issue`, `ops_private_series_paused`) **plus a firehose ops feed**: `ops_booking`, `ops_cancellation`, `ops_attendance` (per player!), `ops_payment`, `ops_membership`, `ops_new_client`, `ops_new_coach`, `ops_player_added`, `ops_wa_linked`, `ops_credit_used`, `ops_coach_change`. All of these currently deliver over WhatsApp.
- **In-app surfaces already exist**: `app/admin/page.tsx` renders the founder ops feed; `app/app/notifications/page.tsx` is the client feed. These absorb everything we pull off WhatsApp.
- **Prefs**: `profiles.notification_prefs` (jsonb, default deliver; `=== false` disables) with a client UI on `/app/profile`. `TRANSACTIONAL` types bypass prefs.

## Cost model (drives every decision below)

Per delivered WhatsApp message: Meta per-message fee **+** Twilio's platform fee (~$0.005 ≈ ₹0.42/msg).

| Path | Meta fee (India) |
| --- | --- |
| Free-form inside 24h service window | ₹0 |
| **Utility** template inside an open window | ₹0 (since late 2024) |
| **Utility** template outside window | ~₹0.13 |
| Marketing template | ~₹0.88 — **never use; all our templates stay UTILITY** |

Implications:
1. **Twilio's flat fee dominates** at India rates → the lever is *fewer, consolidated messages*, not template category games. One message that does three things beats three messages.
2. Every button tap is a user-initiated message that **opens a 24h window**, making our follow-ups free (Meta side). Buttons aren't just UX — they're a cost optimisation.
3. Inbound messages cost us nothing on Meta's side. Deterministic replies to taps cost one Twilio fee.

Rough scale check: ~100 active families × ~8 sessions/mo × 1 reminder + confirmations ≈ low thousands of messages/mo ≈ **hundreds of rupees**, not thousands — *if* the founder firehose and double reminders are gone. Do not add per-user daily caps or other machinery; the policy map + digest below is the whole cost story.

## Design principles

- A WhatsApp message must be **actionable or time-sensitive for its recipient**. Everything else is in-app feed (and, for the founder, one daily digest).
- One event → one message. Consolidate (the after-class summary is the model).
- Buttons run the **exact same RPC as the app**, deterministically, no LLM (the coach handler is the model).
- Every interactive send degrades gracefully to text until its template is approved (existing pattern — keep it).
- WhatsApp **Flows** (in-chat forms) are explicitly **deferred** — see Part 8 for the rationale. Do not build a Flows endpoint.

---

## Part 1 — Delivery policy map (notify worker)

In `supabase/functions/notify/index.ts`, replace the implicit "everything goes to WhatsApp" with one source of truth near the top:

```ts
// Where each notification type is allowed to go. Types absent from this map
// get the default: { wa: true, email: true }. "feed" means the row is only
// ever read in-app: mark it sent without delivering anywhere.
const FEED_ONLY = new Set([
  "ops_booking", "ops_cancellation", "ops_attendance", "ops_payment",
  "ops_membership", "ops_new_client", "ops_new_coach", "ops_player_added",
  "ops_wa_linked", "ops_credit_used", "ops_coach_change",
]);
```

In the delivery loop: if `FEED_ONLY.has(row.type)`, claim the row (flip to `sent`) and `continue` before any profile/prefs lookup. The rows still exist and still render on `/admin` — the founder loses nothing except the pings.

Everything *not* in that set keeps delivering as today. The founder's WhatsApp is now escalations-only, which matches the existing philosophy comment in the file.

## Part 2 — Founder daily digest

New sweep `sweepFounderDigest` in the same file (add to the `safeSweep` list):

- Fires once per IST day at/after **21:00 IST** (guard: `alreadyFired`-style check on type `ops_daily_digest` with `data->>date` = today's IST `YYYY-MM-DD`, per founder).
- Aggregates that IST day's founder `notifications` rows (they're already written — query `type in (…FEED_ONLY ops types…) and created_at` within the IST day, count by type) into **one single-line summary**, e.g. `12 bookings · 2 cancellations · 1 no-show · 3 payments · 1 new client`. Omit zero counts. If everything is zero, **send nothing**.
- Insert one notification per founder: type `ops_daily_digest`, title `Today at the academy`, that line as body, `data: { date, url: "/admin" }`.
- **Single line on purpose**: WhatsApp template variables reject newlines, and outside the service window this rides the digest template (Part 3). Do not build a multi-line digest.

## Part 3 — Template registry & provisioning

Rework `scripts/whatsapp/provision-templates.mjs` into the single registry of *all* templates (keep its idempotent ensure/approve machinery exactly as is; just extend `TEMPLATES`). Add npm script `"wa:provision": "node scripts/whatsapp/provision-templates.mjs"`.

All templates: `language: "en"`, submitted as **UTILITY**. Remember WhatsApp's template rules the script already documents: no adjacent variables, no variable at start/end of body, no emojis/formatting in button titles, no newlines in variable *values* at send time.

New templates (in addition to the two existing coach ones):

| Env key | friendly_name | Type | Content |
| --- | --- | --- | --- |
| `TWILIO_WA_CLIENT_REMINDER_SID` | `client_session_reminder` | quick-reply | Body: `Hi {{1}}! Reminder: {{2}} is on today at {{3}}. See you at the table!` Buttons: `I'll be there` (id `rem_yes`), `Can't make it` (id `rem_no`) |
| `TWILIO_WA_CLIENT_WAITLIST_SID` | `client_waitlist_spot` | quick-reply | Body: `Good news {{1}} — a spot just opened in {{2}}. First to claim it gets it (offer expires in {{3}} minutes).` Buttons: `Claim spot` (id `wl_claim`), `Pass` (id `wl_pass`) |
| `TWILIO_WA_CLIENT_PAYMENT_SID` | `client_payment_issue` | call-to-action | Body: `Hi {{1}}, your last payment for {{2}} didn't go through. Please update your payment method to keep sessions running.` URL button `Fix payment` → `{APP_URL}/app/billing` (static URL) |
| `TWILIO_WA_CLIENT_BOOKED_SID` | `client_booking_confirmed` | call-to-action | Body: `You're booked, {{1}}! {{2}} — see it anytime on your schedule.` URL button `View schedule` → `{APP_URL}/app/schedule` (static) |
| `TWILIO_WA_COACH_PRIVATE_SID` | `coach_private_session` | call-to-action | Body: `New private session, {{1}}: {{2}}. Tap below for the address and details.` URL button `View session` → `{APP_URL}/coach/session/{{3}}` (dynamic URL suffix — Twilio CTA buttons support one trailing variable) |
| `TWILIO_WA_FOUNDER_DIGEST_SID` | `founder_daily_digest` | call-to-action | Body: `Today at the academy ({{1}}): {{2}}` URL button `Open dashboard` → `{APP_URL}/admin` (static) |

Wire each into `interactiveContentFor()` in the notify worker, keyed by notification type (`reminder_upcoming`, `waitlist_spot`, `payment_failed`, `booking_confirmed`, `new_private_session`, `ops_daily_digest`), reading the variables from `row.data` — so **every insert site for these types must carry the needed fields in `data`** (first name, class title, time string, etc.). Follow the existing `coach_before_class` pattern: the sweep/RPC precomputes display strings into `data`, the worker only assembles. For types whose inserts live in SQL functions (booking confirmations, waitlist), it's fine to keep the SQL insert as-is and have the worker fetch the missing display fields — prefer whichever needs fewer schema-function edits; the worker already does per-row profile lookups.

Sends of *any* configured interactive/CTA template must record the outbound `twilio_sid` on the notification row (the existing `deliverWhatsApp` code already does this for every `interactiveContentFor` hit — keep that path shared).

## Part 4 — Client reminders: two messages become one, with buttons

Today every booking inserts `reminder_24h` **and** `reminder_2h` (grep `reminder_24h` in `supabase/schema.sql` — booking, rebooking and reschedule functions all insert the pair). Replace both with **one** reminder:

**Migration `0036_reminder_consolidation.sql`** (via MCP): edit each schema function that inserts the pair so it inserts a single row: type `reminder_upcoming`, `scheduled_for = starts_at - interval '3 hours'`, `data` carrying `booking_id`, `session_id`, `class_title`, plus the display strings the template needs. Keep the existing "delete stale pending reminders on reschedule" logic, extending its type list to `reminder_upcoming` (leave the old type names in the delete so in-flight rows are still swept). Regenerate `schema.sql`, commit together.

Worker/UX:
- `reminder_upcoming` → `client_session_reminder` quick-reply template (Part 3); text fallback keeps the current wording.
- **`rem_yes`** → reply a one-line ack (`See you there! 🏓`). No DB write. (The tap opens a 24h window — that's the win.)
- **`rem_no`** → resolve the booking via `originalSid` → notification row → `data.booking_id`. Cancel it with **the exact same RPC the client app's cancel button calls** (find it: grep `cancel` in `app/app/schedule` / `app/app/book` actions, then confirm the function in `schema.sql`). One tap cancels immediately — no confirm step: members are on monthly billing, cancelling a group booking just frees the spot (waitlist machinery then runs on its own). Reply confirms and offers the rebook link (`/app/schedule`).
- If the client has **multiple bookings on that session** (siblings): reply a numbered list (`Who can't make it? Reply with the number: 1 Aryan · 2 Diya · 3 Both`) and handle the digit reply statefully via the notification row (store the ordered booking ids in its `data` when asking) — same mechanism as the coach absent flow in Part 6.
- Reminders for **private sessions**: reuse the same single-reminder consolidation, but map them to a CTA variant instead of cancel buttons (or plain text if you'd rather not add a 7th template) — one-tap cancelling a private (which debits/credits minutes and frees a coach) is not a tap-safe action. The deep link to the session page is enough.

Dedupe note: the worker's batch dedupe key uses `booking_id` first — for `reminder_upcoming` this means a two-sibling session still sends two messages. Acceptable v1; do not build cross-row merging.

## Part 5 — Client button handling (inbound)

Extend `lib/whatsapp/interactive.ts`:

- Add button ids: `rem_yes`, `rem_no`, `wl_claim`, `wl_pass` to `WA_BUTTON`.
- Split handling by role: the existing coach path is untouched. Add a **client path** that only fires on real taps (payload id or exact button title) — **no loose-word matching for clients**; anything typed falls through to the assistant as today.
- Client actions resolve context **only** via `originalSid` → notification row (the recorded `twilio_sid`). If the row can't be found (>2 days old, etc.), reply with a deep link ("That offer's expired — see your schedule: …") rather than guessing.
- **`wl_claim`** → run the claim/booking path the app uses when a client accepts a waitlist offer (grep `waitlist` in `schema.sql` and `app/app/book/actions.ts` for the exact RPC; there is a `claim_by`/position mechanism — reuse it, including the "too late, spot gone" error → friendly reply).
- **`wl_pass`** → set `read_at` on the offer notification. The existing `sweepWaitlistOffers` then treats it as expired and offers the next person on the next tick — an instant pass instead of a 15-minute timeout. Reply: `No problem — we'll offer it to the next family.`
- Wire into `app/api/whatsapp/route.ts`: currently the interactive handler is only invoked for `profile.role === "coach"`; call it for clients too (the handler itself gates by role/payload). Keep the wa_messages logging identical.

## Part 6 — Coach upgrades

1. **Provision & activate the two existing templates** — this is mostly the manual step (see "Manual steps"), but verify the SIDs land on the edge function and a real tap round-trips.
2. **"Some absent" becomes a numbered reply flow** (no new template needed — the coach's tap opened a service window, so the follow-up is free-form):
   - On `AC_ABSENT`: fetch the session roster (confirmed bookings, ordered by player name), store the ordered booking ids on the after-class notification row (`data.absent_prompt = [ids]`, plus `absent_prompt_at`), and reply a numbered list: `Who was absent? Reply with the numbers (e.g. "2 4") — or 0 if everyone made it after all.` Keep the app deep link in the same message as the escape hatch.
   - New inbound rule (coach role only, before the assistant): if the text is only digits/spaces/commas **and** this coach has a notification with `absent_prompt` set in the last 2 hours → mark those bookings absent and the rest attended. Use the exact statuses the app's attendance UI writes (grep the session page actions — `attended` and the no-show status; confirm the enum value in `schema.sql`, don't assume `no_show`). Reply a summary (`Marked Aryan absent, 5 present ✅`) and clear `absent_prompt`.
   - `0` → mark all attended (same as `ac_present`).
3. **`new_private_session`** → CTA template (Part 3) so the coach gets a tappable "View session" instead of a raw URL.
4. **Time-off outcome**: check the founder's approve/deny action (`approve_time_off` tool / admin action — grep `time_off`): if the coach isn't notified of the decision, insert a notification (type `time_off_decided`, plain text is fine) in the same action/RPC.

## Part 7 — Quiet hours

In the worker's delivery loop, **before claiming**: if the current IST time is in **[21:30, 08:00)** and the type is deferrable, `update notifications set scheduled_for = <next 08:00 IST> where id = … and status = 'pending'` and `continue`.

- Deferrable: `booking_confirmed`, `booking_rescheduled`, `coach_assigned`, `coach_changed`, `role_changed`, `private_series_ended`, `private_minutes_low`, `payment_failed`, `ops_daily_digest` (digest fires 21:00 so normally unaffected), `time_off_requested`, `time_off_decided`.
- Never deferred (time-bound by nature): reminders, `waitlist_spot`, `session_cancelled`, `coach_before_class`, `coach_after_class`, `coach_arrived`, `coach_late`, `new_private_session`, all `ops_coach_*` escalations, `session_issue`, `session_unassigned`, `private_request_parked`.

Note `payment_failed` is `TRANSACTIONAL` (bypasses *prefs*) but still deferrable — nobody fixes a card at 2am. Keep the two concepts (prefs bypass vs quiet-hours exemption) as **separate sets**.

## Part 8 — WhatsApp Flows: deliberate deferral

Twilio supports WhatsApp Flows (`whatsapp/flows` / `twilio/flows` content types — multi-screen in-chat forms). We are **not** building them now:

- Anything dynamic (pick a session to book/reschedule) requires a Flows **data-exchange endpoint**: Meta-specified request signing + payload encryption infrastructure, plus per-flow JSON maintenance — days of work to replicate what the PWA deep links + the assistant already do well.
- Static flows (fixed screens) can't show live data, which rules out every high-value use case we have.
- The interactive surface that pays off (quick replies, CTA buttons, numbered replies) is exactly what Parts 3–6 ship, at a fraction of the complexity.

Revisit only if a concrete need appears for structured *intake* (e.g. a marketing-site lead form: name, child's age, preferred venue as a static flow). Do not build speculatively.

## Part 9 — The assistant/bot: keep as-is (no work)

Decision: **keep the LLM assistant unchanged.** Rationale: it costs nothing when idle (per-message Gemini spend only), it is the graceful floor under every typed reply the buttons invite ("running late for the airport"), and clients/founder can already book, cancel and administer through it. The deterministic layer added above runs *before* it, so the assistant's role narrows naturally to genuine free text. Removing it would break typed-reply fallbacks for zero savings. No changes to `lib/whatsapp/agent.ts` or the tools.

## Part 10 — Docs & prefs hygiene

- Rewrite `docs/whatsapp-interactive.md` to describe the full system after this plan (policy map, digest, template registry table with env keys, client buttons, quiet hours). It's the operational doc — keep the provisioning runbook in it current.
- `/app/profile` notification prefs UI: make sure the listed types match the new reality (add `reminder_upcoming`, drop the dead `reminder_24h`/`reminder_2h` labels if they're enumerated there; check `app/app/profile/page.tsx`).
- Do **not** build founder/coach prefs UIs — the policy map and digest are the controls.

---

## Execution order & commits

Each step leaves the system working; the text-fallback pattern means nothing depends on template approval timing.

1. **Policy map + feed-only routing** (Part 1) — instant founder spam fix, zero risk. Deploy notify.
2. **Founder daily digest** (Part 2). Deploy notify.
3. **Quiet hours** (Part 7). Deploy notify.
4. **Template registry** (Part 3 script changes) + run provisioning + submit approvals (manual gate opens here; everything below still works as text meanwhile).
5. **Reminder consolidation migration** (Part 4 DB) + worker mapping + `schema.sql` regen, one commit.
6. **Client inbound buttons** (Part 5) + coach absent flow & time-off outcome (Part 6).
7. **CTA wiring for remaining types** (booked, payment, coach private) once SIDs approved → set secrets, deploy notify.
8. **Docs + prefs cleanup** (Part 10).

## Manual steps (founder/operator — cannot be automated)

1. `npm run wa:provision` (needs `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` in `.env.local`).
2. Watch approvals in Twilio Console → Messaging → Content Template Builder (asynchronous, usually minutes–hours).
3. `supabase secrets set TWILIO_WA_COACH_REMINDER_SID=HX… TWILIO_WA_COACH_AFTERCLASS_SID=HX… TWILIO_WA_CLIENT_REMINDER_SID=HX… TWILIO_WA_CLIENT_WAITLIST_SID=HX… TWILIO_WA_CLIENT_PAYMENT_SID=HX… TWILIO_WA_CLIENT_BOOKED_SID=HX… TWILIO_WA_COACH_PRIVATE_SID=HX… TWILIO_WA_FOUNDER_DIGEST_SID=HX…` then redeploy `notify`.
4. Spot-check one live round-trip per button on a real phone (coach reminder tap, client reminder tap, waitlist claim).

## Verification checklist

- `npm run lint` and `npm run build` pass after each commit; `notify` deploys cleanly via MCP after each worker change.
- MCP `get_advisors` clean after the migration; `schema.sql` regenerated and committed with it.
- Feed-only: insert a test `ops_booking` row via MCP → it flips to `sent` with **no** Twilio call (check `get_logs` for the function), and still renders on `/admin`.
- Digest: with a day's ops rows present, exactly one `ops_daily_digest` per founder per IST day; zero-activity day sends nothing.
- Reminder: book a test session ≥3h out → exactly **one** pending reminder row, correct `scheduled_for`; reschedule sweeps and re-inserts it.
- Buttons (post-approval): `rem_no` cancels the booking and triggers the waitlist offer; `wl_pass` causes the next-in-line offer on the next cron tick; coach digits reply writes the same booking statuses as the app UI.
- Quiet hours: a `booking_confirmed` created at 23:00 IST is deferred to 08:00; a `waitlist_spot` at 23:00 is not.
- Loose typed words ("coming", "arrived") still work for coaches; client free text still reaches the assistant.
