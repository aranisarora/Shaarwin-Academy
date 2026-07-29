# Notification fix — execution record

Companion to `docs/notification-fix-plan.md` (the what) and
`docs/notification-fix-owner-actions.md` (what needs your hands). This is what
was actually built, what changed, and what's left.

Executed 2026-07-29/30 against `main`. Every item below is committed, pushed,
and verified: `npm run test:db` **57/57**, `npx vitest run lib/` **43/43**,
`tsc --noEmit` clean, `eslint` clean, `npm run build` succeeds.

---

## Done

| Item | What changed |
| --- | --- |
| **1.4** (G12) | Retired `coach_class_reminder` no longer provisioned; the hand-built generic template documented |
| **1.5** | `notifications.error` + `channel_attempted`; `deliver()` returns an attempt result with a reason chain; Twilio's numeric code surfaced. Fixes G8 (unset `RESEND_API_KEY` used to record undeliverable rows as **sent**) |
| **1.6** | `wa_inbound_seen` claim table keyed on Twilio `MessageSid` — kills the triple "I've arrived" replies |
| **2.1** | `queue_coach_changed()` collapses same-day repeats into one summary. The Jul 22 blast (376 rows) becomes ~1 per person |
| **2.2** | Per-user daily cap (3) on non-essential messages, with an operational exemption set |
| **2.3** | STOP/START, deterministic, ahead of buttons and the LLM. `profiles.wa_muted` |
| **2.4** | G1 fixed (client private copy has its own type + template gated on a `/coach/` link); `withValidCoaches()` guard + `ops_session_coach_invalid` |
| **2.5** | G3, G4 and old→new payloads at every insert site |
| **2.6** (G9) | Three grouped toggles; unmutable list is now deliberate data |
| **C11 / M1** | `player_absent` (transactional, never deferred) + `session_outcome` with the coach's note |
| **C4** | The 3-hour reminder on academy-booked privates — see below |
| **K8** | Cover offers to eligible coaches, first-tap-wins |
| **Bot** | `get_player_today`; `istDayBounds()` fixes the "no coaching today" bug |

Migrations `0041`–`0047`, all applied live, all paired with a refreshed
`supabase/schema.sql` and regenerated `lib/database.types.ts`.

---

## What the audit got wrong, and what production actually said

Three of the plan's premises didn't survive contact with the data. Worth
recording, because each changed what got built.

**1. There are three founder accounts, not two.** Every escalation fans out to
all of them — 40 escalated sessions produced 146 rows in three days. The
unlinked "Sharwin Table Tennis Academy" account fails its third of them
(243 failures). Retiring it cuts total escalation volume by a third *and* stops
the bleeding. Your own account also has no `wa_links` row, so you are on email,
not WhatsApp.

**2. The email fallback probably works for exactly one person.** The worker
sends as `notify@resend.dev` — Resend's shared test domain, which by policy only
delivers to the account owner's own address. The data fits exactly: your account
0 failures, the other founder 243. Verifying a real sending domain likely fixes a
whole class of failures that has nothing to do with WhatsApp.

**3. "Clients receive almost nothing" is not about group bookings.** The plan
asked us to check the confirmation path "for group bookings". Group is fine —
2 of 2 recent group bookings got a confirmation. The real shape: over three
weeks production had **52 private bookings and 2 group ones**, and virtually all
the privates are booked from /admin. That admin path queued **no
`reminder_upcoming` at all** — 11 reminders against 52 bookings. The
client-initiated RPC always did, which is exactly why RPC-level tests never
caught it.

Also confirmed at production scale: **20 `new_private_session` rows went to
clients**, i.e. 20 parents got the coach-worded message with a `/coach/session/`
link they can't open. That's G1, and 2.4 fixes it going forward.

---

## Deliberate deviations from the plan

Each is argued in its commit message.

- **2.2's cap is not literal.** "Max 3 non-transactional sends per user per day"
  would silence a coach teaching four classes — before/after-class prompts are
  non-transactional. `CAP_EXEMPT` carves out time-critical and
  session-operational types so the cap bites the informational tail instead.
- **STOP keywords are narrower than Twilio's standard set.** CANCEL, END and
  QUIT are excluded because a parent typing "cancel" means their booking; YES is
  excluded because coaches type it to confirm a class. A missed keyword is
  recoverable; a false positive silences a paying family silently.
- **`session_outcome` (the positive) is mutable, `player_absent` is not.** An
  absence is a safety matter. A parent happy with the arrangement shouldn't be
  forced to hear about every session.
- **`coach_arrived` became mutable, `coach_late` did not** — the plan's own C10
  exceptions-first amendment. A coach *not* being there is what a parent needs.

---

## Not done — and why

**Everything below is blocked on the same thing: the Twilio templates (1.4).**
The plan's own instruction is "fix delivery and the ladder before building any
new messages", and none of these can reach a member outside the 24h window until
the templates exist. Building five more senders that can't be delivered has less
value than what's already shipped, so this is where I stopped.

| Item | Status |
| --- | --- |
| **K3 / F1 / C7** — the three morning briefs | Not started. One build, three audiences. Hold K3's "All confirmed" button until 1.1 is verified live |
| **C13/C14 + C1/C2** — receipts, renewal notice, trial funnel | Not started. C14 closes G6 (a toggle with no sender) |
| **C12 / K9** — monthly progress + assessment chase | Not started. `session_outcome` already carries the coach's note, which is the input C12 needs |
| **C19** — new class open | Not started |
| **F7 rebuild / F8 weekly** | Not started |
| **1.2** — verify escalation volume drops | Blocked on the 1.1 deploy; re-run the §0 queries after 3 class days |

### Two things found but not changed, on purpose

- **G2** — `ops_payment_issue` and `ops_private_series_paused` are named like
  feed items but are in neither `FEED_ONLY` nor `OPS_DIGEST_LABELS`, so they
  ping the founder's WhatsApp immediately *and* are invisible in the digest.
  That is founder spam, but the plan leaves it unassigned. One-line fix once you
  decide: escalation (rename) or feed (add to both lists).
- **`getCoachNames()` in `lib/booking.ts`** reads `profiles` directly and hits
  the same RLS wall `get_player_today` did, so `my_schedule` and the /app
  screens built on it show a **null coach name** for parents. Same class of bug,
  but it's shared code on several screens and outside this plan's scope. The fix
  is the one used in the bot tool: read `public_coach_roster()` instead.

---

## New templates needed (add to the 1.4 list)

Two message types shipped here have no Twilio template yet. Both degrade to
plain text meanwhile, and typed replies still work:

- **`cover_offer`** — ideally a quick-reply with a single **Claim it** button
  (button id `cover_claim`, which `lib/whatsapp/interactive.ts` already
  handles). Variables: `{{1}}` class title, `{{2}}` time, `{{3}}` venue.
- **`player_absent`** — no buttons; the reply channel is free text, which the
  LLM already fields. Variables: `{{1}}` player first name, `{{2}}` class title,
  `{{3}}` time.

---

## Verify after the 1.1 deploy

```sql
-- the ladder should now exist at all
select type, count(*) from notifications
 where type in ('coach_confirm_nudge_2','coach_arrival_check') group by 1;

-- failures now explain themselves — this is the 1.5 payoff
select type, error, channel_attempted, count(*) from notifications
 where status='failed' and created_at > now() - interval '1 day'
 group by 1,2,3 order by 4 desc;

-- escalation volume, expected to fall sharply
select created_at::date, count(*) from notifications
 where type in ('ops_coach_unconfirmed','ops_coach_not_arrived')
 group by 1 order by 1 desc limit 7;

-- cover working = escalations replaced by outcomes
select type, count(*) from notifications
 where type in ('cover_offer','ops_cover_claimed') group by 1;
```
