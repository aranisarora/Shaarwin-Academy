# Notification & WhatsApp bot — execution plan

Written 2026-07-29 from a live audit of the production database (notifications,
wa_messages, wa_links, profiles) plus `docs/notification-plan.md` and
`docs/whatsapp-messaging.md`. This is the **do-this-next** document; the other
two stay as the target-state spec and the as-built reference.

## 0. What production actually shows (Jul 11–29)

| Finding | Evidence |
| --- | --- |
| Arrival ladder has **never fired** | 0 rows ever of `coach_arrival_check` or `coach_confirm_nudge_2`; `coach_before_class` (T-60) fires fine since Jul 20 |
| Founder escalated 487× about a ladder that never ran | 350 `ops_coach_unconfirmed` + 137 `ops_coach_not_arrived` sent in 18 days |
| Second founder account receives nothing | profile "Sharwin Table Tennis Academy": no phone, no `wa_links`; ~300 failed rows incl. 6/6 digests and 7 signup requests, still failing daily |
| One bulk reassignment blasted clients | Jul 22: 376 `coach_changed` in one day (188 to clients — "Meet your new coach"). Steady state 2–9/day |
| Coach delivery failures are concentrated | Keerthana: 191 failed `coach_changed` + 19 failed `coach_before_class` **despite** having a wa_link and phone — consistent with unprovisioned template SIDs / no generic fallback template |
| Clients receive almost nothing | Ever: 3 `booking_confirmed`, 1 `reminder_upcoming` (10 pending, none overdue), 2 announcements. 28/39 clients are WhatsApp-linked |
| Coach interactive flow works | Live conversations: "I'm coming" → confirm, "I've arrived" → arrival, "All present" → attendance, founder Approve → onboarding link. This is the healthy core |
| Inbound duplicates | Same coach message ("I've arrived") processed 3× within one second, 3 replies sent — Twilio webhook retries are not deduped |
| Coach-typed messages delivered to a client | Purnendu (role=client) received `coach_before_class`/`coach_after_class` for "Apr Villa Private" — a session's `coach_id` points at a non-coach profile |
| The safety gap is live | A parent asked the bot "Where is he?" about their child mid-day; the bot had nothing to answer with (no attendance/arrival message exists for parents) |
| No delivery observability | `notifications` stores only `status='failed'` — no error text, no channel attempted. Every diagnosis above had to be inferred |
| No STOP handling | No opt-out path in `lib/whatsapp/`; free-text "STOP" would go to the LLM |

Headline: **the plan's worry (client spam) is inverted in production.** Clients
are under-messaged; the spam victims are the founder (escalations about a
broken ladder) and coaches (a one-day bulk blast + silent delivery failures).
Fix delivery and the ladder before building any new messages.

---

## Phase 1 — Stop the bleeding (small, independent, do first)

**1.1 Redeploy the notify worker — root cause found, no debugging needed.**
The deployed edge function (version 26, updated Jul 24; verified via MCP
`get_edge_function`) is an **older build** than
`supabase/functions/notify/index.ts` in the repo. The deployed build has no
`sweepCoachConfirmNudge` and no `sweepArrivalCheck` at all — that is the
entire reason those types have zero rows. The stale build also (a) escalates
`ops_coach_unconfirmed` on `coach_confirmed_at` alone, ignoring
`coach_arrived_at` (the local version checks both — a coach who tapped
"arrived" without confirming still gets the founder escalated today), and
(b) maps `coach_before_class` to the deprecated `TWILIO_WA_COACH_REMINDER_SID`
where the local file + provisioning script use `TWILIO_WA_COACH_COMING_SID`.
Fix: deploy the local `index.ts` as-is (MCP `deploy_edge_function` or
`supabase functions deploy notify`). Do not edit the sweep logic first — the
local file is already correct. Add a `tests/db/`-style spec for the two sweep
windows if practical, but the deploy itself is the fix.
*Done when:* `coach_confirm_nudge_2` and `coach_arrival_check` rows appear in
production within one class day, and `ops_coach_unconfirmed` stops firing for
sessions whose coach has `coach_arrived_at` set.

**1.2 Verify escalation volume drops after 1.1.**
No code change expected beyond the redeploy: the local build already skips
escalation when the coach confirmed *or* arrived, and the T-30 nudge gives
coaches a chance to respond before the founder is pinged. Re-run the audit
query after 3 class days; if founder escalations are still ~27/day,
additionally gate `ops_coach_unconfirmed` on "a nudge row exists for this
session" (escalate only if we asked).
*Done when:* founder escalations reflect only genuinely silent coaches.

**1.3 Resolve the second founder account.**
Decision needed from you: link a phone (insert `wa_links` via the existing
verified-phone path) **or** demote/retire the "Sharwin Table Tennis Academy"
profile from `founder`. Either ends ~15 failed rows/day. The plan's build
order has this as item 2; production confirms it's still bleeding.
*Done when:* zero new failed rows for that user for 3 days.

**1.4 Provision the WhatsApp templates.**
Run `npm run wa:provision`, wait for Twilio approval, set every
`TWILIO_WA_*_SID` env var on the notify worker, and build + approve the
generic `TWILIO_WA_TEMPLATE_SID` by hand (§7 of whatsapp-messaging.md — the
script does not create it). This is the single biggest delivery fix: it
explains Keerthana's 191 failures and all `coach_before_class`/`after_class`
failures for linked coaches, and it's what makes buttons show outside the 24h
window. Drop the unused `coach_class_reminder` template from the script (G12).
*Done when:* a linked coach with no 24h window receives a templated
before-class message with buttons.

**1.4b Audit env vars on the freshly deployed worker.**
After 1.1 + 1.4, confirm every SID name the *current* worker reads is set as a
function secret: `TWILIO_WA_COACH_COMING_SID` (not the old `..._REMINDER_SID`),
`..._COACH_ARRIVAL_SID`, `..._COACH_AFTERCLASS_SID`, `..._COACH_PRIVATE_SID`,
`..._CLIENT_REMINDER_SID`, `..._CLIENT_WAITLIST_SID`, `..._CLIENT_PAYMENT_SID`,
`..._CLIENT_BOOKED_SID`, `..._CLIENT_ARRIVED_SID`, `..._CLIENT_LATE_SID`,
`..._CLIENT_APPROVED_SID`, `..._FOUNDER_DIGEST_SID`, `..._FOUNDER_SIGNUP_SID`,
and the hand-built generic `TWILIO_WA_TEMPLATE_SID`. A name mismatch fails
silently (the worker treats an unset SID as "no template").

**1.5 Record delivery errors.**
Add `notifications.error text` (+ `channel_attempted`) written on failure, and
stop `deliver()` returning `true` when `RESEND_KEY` is unset (G8) — mark
`failed` with `error='no_channel'`. One migration + worker change; refresh
`supabase/schema.sql` in the same commit per repo rules.
*Done when:* every new `failed` row says why.

**1.6 Dedupe inbound webhook retries.**
Key on Twilio `MessageSid`: if a `wa_messages` row (or a small
`wa_inbound_seen` table) already has it, ack and skip. Kills the triple
"I've arrived" replies.
*Done when:* replaying the same SID produces one reply.

---

## Phase 2 — Brakes and hygiene (before adding any new message types)

**2.1 Bulk-operation suppression.**
The Jul 22 blast (376 `coach_changed` in a day) came from a mass
reassignment. Two changes: (a) per-user-per-day dedupe for `coach_changed` —
one "your schedule was updated" summary instead of N rows; (b) admin bulk ops
(`lib/admin-ops*.ts`) pass `p_notify=false` / batch into one notification per
affected user. Case study to assert in a `tests/db/` spec: re-assigning a
coach across a whole series must produce ≤1 client message per household.

**2.2 Per-user daily cap in the worker.**
Fourth rule set alongside TRANSACTIONAL/DEFERRABLE/FEED_ONLY: max 3
non-transactional WhatsApp sends per user per day; overflow defers to the next
morning (or drops if stale, e.g. `coach_arrived`). This is the structural
guarantee behind "don't spam anyone" that survives every future message added.

**2.3 STOP/START handling.**
Deterministic, before the LLM: inbound body exactly `STOP`/`UNSUBSCRIBE` sets
all mutable prefs off (and a `wa_muted` flag honoured by the worker for
everything non-transactional); `START` reverses. Confirm whether Twilio's
Advanced Opt-Out is already intercepting these; either way the DB must know.

**2.4 Fix coach-typed messages reaching clients.**
Two bugs, one theme: (a) G1 — `new_private_session` client copy renders the
coach template with a `/coach/session/...` link; give the client its own type
or gate on `data`; (b) the Purnendu case — sessions whose `coach_id` is not a
coach profile still get the coach message loop. Add a role check at the sweep
sites and a feed alert (`ops_*`) when a session's assigned coach lacks the
coach role.

**2.5 Payload gaps at insert sites (plan §9 item 3).**
`payment_failed` carries `{url}` only (G3), waitlist offers can't name the
class (G4), `coach_arrived` loses the coach name on most sends, `class_updated`
/`session_moved` carry no old→new. Fix in the RPCs/triggers, each with a
`tests/db/` payload assertion — the plan's Definition of Done (§10) applies.

**2.6 Widen mutable prefs (G9).**
Grow `PREF_TYPES` into three grouped toggles — *Reminders · Progress · News &
offers* — and move `coach_arrived` + receipts into mutable. Keep hard-line
unmutable only for safety (cancellations, absence) and money-at-risk.

---

## Phase 3 — Build the missing messages (plan §9 order, amended by live data)

Priority re-ordered by what production showed:

1. **C11 — session outcome to the parent** (attended/absent + what was worked
   on). The "Where is he?" conversation is this gap live. Transactional,
   never deferred. Include the M1 absent copy from whatsapp-messaging.md §9.2.
2. **C4/C5 payload + queueing fix** — clients have received 3 booking
   confirmations ever; confirm the insert path actually fires for group
   bookings and carries class/day/time; add waitlist ack (C5).
3. **K8 — cover offers to eligible coaches** (first-tap-wins, mirror waitlist
   claim). Converts the founder's biggest escalation category into
   self-service.
4. **K3 / F1 / C7 — the three morning briefs.** One build, three audiences.
   Hold K3's "All confirmed" button until 1.1 is verified in production.
   F1 leads with exceptions; full session roster only when something's wrong.
5. **C13/C14 + C1/C2 — receipts, renewal notice, trial funnel.** Renewal
   notice closes G6 (toggle exists, no sender).
6. **C12/K9 — monthly progress + assessment chase.** The retention pair.
7. **F7 rebuild + F8 weekly** — money totals and at-risk families in the
   digest; fold escalation counts in (G13).

Also adopt into `notification-plan.md` (plan amendments):

- **C10 becomes exceptions-first**: keep `coach_late` always; make
  `coach_arrived` mutable (2.6) — reassurance decays with repetition.
- **C19 · New class open** (new): when the founder creates a weekly class,
  offer it to waitlisted + matching-level families (mutable, deferrable).
  Currently the only tool is a manual broadcast.
- **Volume note**: state the per-user cap (2.2) as a plan rule in §8.

## Bot (inbound) changes

- **Parent live-status tool**: give the client LLM toolset a
  `get_player_today` tool (today's sessions, coach arrival status, attendance
  once marked) so "Where is he?" gets a real answer even before C11 ships.
- **Coach schedule mismatch**: Keerthana was told "no coaching today" and
  pushed back naming a venue. Verify the coach `list_sessions` tool includes
  school and private sessions and uses IST day bounds; add a Layer-1 test.
- **Keep the deterministic layer as-is** — matching rules and reply copy are
  working well in production; no changes beyond dedupe (1.6) and STOP (2.3).

## Execution notes for the implementing agent

Read this section first. The plan will be executed by an agent; these are the
rails.

**Human-only steps — stop and ask, do not attempt:**
- Twilio template approval (1.4): you can run `npm run wa:provision`, but
  approval is Meta's review queue and the generic `TWILIO_WA_TEMPLATE_SID`
  template must be created by hand in the Twilio console.
- Setting edge-function secrets (1.4b): env vars are set in the Supabase
  dashboard / CLI by the owner. Produce the exact list of names+where to put
  them; don't guess values.
- The second-founder-account decision (1.3): link vs demote is the owner's
  call. Present both, wait.
- Deploying to production (1.1): prepare everything, then ask before the
  actual deploy — it changes live message behaviour.

**Hard rules:**
- Never insert, update, or delete rows in the **live** database to test
  anything. All write-path testing happens on the local harness:
  `npm run db:start`, then `npm run test:db` (Vitest specs in `tests/db/`).
  The live DB is read-only for you (audits, verification queries).
- Any migration must be paired with a regenerated `supabase/schema.sql` in the
  same commit — the pre-commit hook blocks you otherwise. Regenerate via the
  Supabase MCP (query the catalog), not by hand-editing.
- Do not "fix" the behaviours listed under "already handled well" in
  `docs/whatsapp-messaging.md` §8 — they look like bugs and are deliberate.
- When touching a Postgres function, update the affected `tests/db/` spec in
  the same commit and run the suite (repo definition-of-done).
- One phase item per commit where possible; do not batch 1.5 and 1.6 into the
  same change as 1.1's deploy.
- The local `supabase/functions/notify/index.ts` is **newer than production**.
  Never copy code *from* the deployed version back into the repo.

**Verification queries (run read-only against live, before and after):**
```sql
-- ladder firing?
select type, count(*) from notifications
 where type in ('coach_confirm_nudge_2','coach_arrival_check')
 group by 1;
-- escalation volume per day
select created_at::date, count(*) from notifications
 where type in ('ops_coach_unconfirmed','ops_coach_not_arrived')
 group by 1 order by 1 desc limit 7;
-- failure rate by type, last 3 days
select type, status, count(*) from notifications
 where created_at > now() - interval '3 days'
 group by 1,2 order by 3 desc;
```

## Sequencing & verification

Phases are ordered; items within a phase are parallelisable. Every DB change
ships with its `tests/db/` spec and a regenerated `supabase/schema.sql`
(pre-commit hook enforces the latter). After Phase 1, re-run the §0 queries
for a week and expect: ladder types firing, founder escalations ≪ 27/day,
zero failed rows for linked users, every failed row carrying an error.
