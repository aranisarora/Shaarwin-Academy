# Sharwin bot upgrade — day-to-day, on Meta Cloud API

> **Status:** §3 and §2 built, §4.2 built, §4.1 and §5 not started. See the execution log directly below before continuing — two of the plan's assumptions were wrong, and a live bug turned up that nothing in the plan predicted.
>
> **Workflow:** built on the `sharwin-bot-upgrade` branch. No PR — the branch is the workspace.
>
> **Hard scope lines:** no onboarding of any kind (every family is already onboarded), **no money changes** (Razorpay memberships and private minutes stay exactly as they are), no app changes (the app stays frozen), no platform concerns (tenancy, fleet, recipes — that's the other project).

---

## 0. Execution log — read this first

**2026-08-12.** Commits `ca2b1b1` (brain), `1915f5b` (bursts), `3b64406` (transport +
delivery). Nothing was applied to production: migrations `0085`–`0087` exist as files
only, and no edge function was deployed. Verified locally against Docker Supabase —
`npm run db:reset` clean, `npm run test:db` 234 green, `npm test` 442 green,
`npm run build` clean.

### What shipped

| Plan | State | Notes |
| --- | --- | --- |
| §3.1 resolver | **done** | New `resolve` tool: one ranked, typed lookup across players, accounts, coaches, classes, venues. Tokenised, so "abhay" and "gupta abhay" both reach Abhay Gupta. |
| §3.2 working memory | **done** | `wa_entity_memory` (0085), harvested from tool *results* and injected each turn. |
| §3.3 joins | **done** | `player_name` on sessions/bookings/both series tables and on `clients`. Filters get their own role list. |
| §3.4 bursts | **done** | Claim row is the queue; `wa_chat_locks` (0086) serialises; writes yield to unread input. |
| §2 transport | **built, dormant** | `transport.ts` seam + `cloud-api.ts`. `WHATSAPP_TRANSPORT` defaults to twilio. |
| §4.2 delivery proof | **built, half-fed** | `wa_delivery` (0087), monotonic. Digest line + worker wiring still to do. |
| §4.1 feedback after class | **not started** | Needs the notify worker, which is a separate Deno deploy. |
| §5 founder menus | **not started** | Depends on Cloud API list pickers being live. |

### Where the plan was wrong

1. **§3.3 overstated the work.** `find` already traversed relationships — the registry
   has had embeds and `!inner` promotion all along. The real gap was that no filter let
   you *start* from a name: answering "what did Aarav have today" meant looking the
   player up, carrying the id across, and querying again, and the middle step is exactly
   where the bot guessed the wrong table. Four filters fixed it, not a new engine.

2. **§3.2 named lint as the cause; it is only half.** Lint stripping uuids is one rule.
   The other is that `loadHistory` rebuilds the model's whole context from the *stored
   text* and tool calls are never persisted. Either rule alone is harmless. The fix
   changes neither — it moves the referents somewhere lint does not reach.

3. **A live bug the plan never mentions.** Migration `0081` renamed `venues.active` to
   `is_public`, and the `find` registry kept the old name — in the venues entity *and* in
   the venue embed that `classes` pulls in **by default**. So `find` on venues and on
   classes was failing outright, for every staff role, with a PostgREST error. Fixed. The
   same stale rename had also been breaking `npm run db:reset` since 0081, which is why
   nobody had caught it: the harness that would have failed loudly could not start.

### Deliberate omissions, with reasons

- **`deliveries.notification_id` is a column but not a filter.** Only the notify worker
  can populate it and that worker has not shipped this change. A filter over an
  always-null column answers "none" to every question — the exact failure mode this
  registry keeps being repaired for.
- **No `coach_name` filter on sessions.** `profiles` is owner-scoped, so
  `coaches!inner(profiles!inner(full_name))` resolves to null for a coach or client and
  the `!inner` then drops *every* row. Filters that read through an owner-scoped table
  now carry their own `roles` list rather than silently answering nothing.
- **`isReadOnlyTool` defaults unknown tools to WRITE.** There are 68 and more each
  month. Mistaking a write for a read cancels a session someone just retracted;
  mistaking a read for a write costs one indexed query.

### Still founder-manual — none of it blocks the build

1. **Apply `0085`, `0086`, `0087`** to production by executing the SQL directly (Studio
   or a `pg` script — `supabase db push` is a no-op here by design). Until then the bot
   runs exactly as before: memory, coalescing and delivery all degrade to the old
   behaviour rather than erroring.
2. **Cloud API go-live**, in this order and not before: create the test WABA, re-create
   and get the templates approved, set `WHATSAPP_CLOUD_TOKEN`,
   `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_APP_SECRET`,
   `WHATSAPP_CLOUD_VERIFY_TOKEN`, point the test number's webhook at
   `/api/whatsapp`, and only then set `WHATSAPP_TRANSPORT=cloud`. Twilio stays warm.
3. **`supabase functions deploy notify`** whenever the worker is next touched — it has
   no autodeploy and has silently drifted twice.

### Next, in order

1. Feed `wa_delivery` from the notify worker (`data.twilio_sid` is already recorded per
   send) and add the digest line — `deliveryLine()` is written and tested, unused.
2. §4.1 feedback after class.
3. §5 founder menus, once Cloud API list pickers are live.

---

## 1. What this upgrade is

Three things, in order of value:

1. **A smarter brain** — the bot stops failing on questions it should answer: cross-entity name resolution, multi-hop questions, references to earlier turns, and message bursts.
2. **Meta Cloud API replaces Twilio** — which unlocks the in-window UX the current bot can't have: free-form interactive messages, buttons on everything, typing indicators, delivery statuses.
3. **Two day-to-day flow additions** — feedback after class, and delivery proof for the founders.

---

## 2. Transport: Twilio → Meta Cloud API direct

- **Swap behind the seam.** Webhook in, sends out — the transport layer is replaced; the agent loop, tools, notification orchestration, and lint layer stay.
- **Template parity first.** The provisioned Twilio templates are re-created and re-approved on the new WABA before anything else moves. Business-initiated messages keep working from day one.
- **In-window free-form unlocked.** Replies inside the 24h window need no template and no approval — interactive buttons, list pickers, and CTA-URL buttons become available on every reply, not just on pre-approved shapes.
- **Every link becomes a button.** Session links, dashboard links, payment links — always behind a labeled CTA button. The bot never pastes a bare URL into message text again.
- **Presence niceties.** Typing indicator while the agent is working (it also reduces double-sends — see §3.4), emoji reactions as zero-noise acknowledgments, mark-as-read.
- **Test number first.** Everything is built and verified against a fresh test number and WABA — template approvals included — with real founders and coaches playing the roles. The real Sharwin number migrates from Twilio only once the test number has run clean for a while, on a quiet evening, with Twilio kept warm as the fallback until confidence is earned. Parents' threads survive the migration: same number, same chat, better bot.
- **Deploy discipline carries over.** The `notify` function has no autodeploy; manual deploys remain part of the definition of done for any notification change.

---

## 3. A smarter brain

### 3.1 Resolve first — never guess a table

Today: *"what classes did Aarav have today"* → *"I can't find a client named Aarav"* — because the bot guessed an entity type (client), searched only there, and reported its failed guess instead of answering the question. Aarav is a player.

The fix is a **resolver**: one lookup across players, clients, coaches, classes, and venues, fuzzy-matched (normalized, partial-name tolerant, typo tolerant), returning **typed, ranked candidates with context** — "Aarav — player, Meera's son, Beginners Batch." The agent's doctrine changes with it:

- **A failed guess is a banned reply.** If *any* entity matches the name, the bot either answers the question that was asked or asks a disambiguating question. "No such client" while a player named Aarav exists is a bug, full stop.
- **Ambiguity is buttons, not failure.** Two Aaravs → "Which one? [Aarav — Beginners] [Aarav — Advanced]". One tap, resolved.

### 3.2 Working memory that survives the lint layer

The bot's only memory today is the visible conversation — and the lint layer (correctly) strips internal IDs out of the visible text. Net effect: the model repairs its own memory away, and "her", "that one", "cancel it" lose their referents a turn later. This is the root cause of the known cross-turn failures.

The fix: **server-side conversation state** — a working memory per chat holding the entities resolved in recent turns (`"Aarav" → player:…`, `"tomorrow's Beginners session" → session:…`), injected into the agent's context each turn. Lint keeps cleaning the visible text; the model's memory no longer lives in it. Pronouns and back-references resolve from state, deterministically, instead of being re-guessed from prose.

### 3.3 Questions that need joins

"What classes did Aarav have today" is a three-hop question: player → bookings → today's sessions. The founder's read tool gains **relationship traversal and aggregation** so multi-hop questions are one call instead of a chain of guesses — with the existing entity/column allow-lists and RLS still in front. The target: any question the data can answer, the founder can ask in one sentence.

### 3.4 Many messages at once

People text in fragments: "cancel tomorrow" … "actually just move it" … "to 5pm". Today each inbound is claimed exactly once (no double-processing — that guarantee stays), but the turn semantics need defining. The upgrade's rules:

- **One run per conversation.** Agent runs are serialized per chat; two runs never race on the same thread.
- **Bursts coalesce.** Messages that arrive while a run is in flight (or within a short arrival window) fold into the turn. The bot answers the *latest complete ask*, once — not each fragment with its own contradicting reply.
- **No write with unread input.** Before any state-changing tool call, the run checks for newer inbound and absorbs it first. A correction ("no, 5pm not 4") must always beat the action it corrects.
- **The typing indicator does prevention.** Visible "typing…" is the strongest known reducer of impatient double-sends.

---

## 4. New day-to-day flows

### 4.1 Feedback after class

The session-outcome message parents already receive gains a **one-tap rating** (plus an optional typed comment as a reply). Piggybacked, never a separate ping; frequency-capped so it stays welcome; visible to the founders in the digest. The parents' half of the quality loop, at zero extra message cost.

### 4.2 Delivery proof

Cloud API reports per-message statuses; the upgrade surfaces them:

- Every send tracked **queued → sent → delivered → read**.
- The 21:00 digest gains a **delivery-health line**: "41 reminders, 40 delivered, 1 failed — tap for who."
- Founders can ask about any message — *"did Meera get the reminder?"* — and get the exact status and time.
- Persistent failures (wrong number, block) surface as fixable alerts instead of silent gaps.
- The existing rule stands and gets teeth: **the bot never claims what it can't see** — "queued" is never reported as "sent."

---

## 5. UX rules carried through

- **One question at a time** — the ladder rhythm stays; richer UI never becomes noisier UI.
- **Two-step confirms stay** for anything consequential (dropping a class, cancelling a booking) — a pocket mis-tap must never cost a seat or trigger cover.
- **Menus for the founders.** A persistent list-picker entry point — *Schedule / Clients / Money / Coaches / Insights* — as the discovery surface over the 44 founder tools. Taps, then prose.
- **Quiet hours, digests, escalation ladders** — unchanged.

---

## 6. Testing & rollout

1. Template re-approval on the test WABA is the long pole — it starts first.
2. Transport swap verified on the test number: every notification type, every button action, end to end.
3. Brain upgrades (§3) land behind the same tests: `tests/db` specs for resolver and status RPCs, e2e flows where behavior changes — existing harness conventions apply.
4. Real-number migration on a quiet evening, Twilio kept as fallback until the first clean week.

## 7. Explicitly out of scope

| Not in this upgrade | Why |
| --- | --- |
| Onboarding (owners, coaches, parents, invites) | Everyone is already onboarded; onboarding is a platform concern. |
| Any billing change (per-class, tallies, reconciliation) | Razorpay memberships + minutes work today; risk with zero urgency. |
| Magic-link web views | Deferred by decision; revisit after the upgrade lands. |
| Player-number reminders (teens) | Open design thread; not settled. |
| Platform doctrine rebuild (generic primitives, recipes, mint-once) | The platform is a separate greenfield project; rebuilding the live bot's write side duplicates work that won't transfer. |
| App changes | The app stays frozen. |
