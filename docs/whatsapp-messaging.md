# WhatsApp messaging — full reference

> ## Read this first — parts of this document are historical
>
> Re-verified 2026-07-31 against production. This file was written as an
> **audit**, and most of what it flagged has since been fixed. It is kept for the
> reasoning (§9–§11), which is still the best statement of *why* the system is
> shaped this way — not as a status report.
>
> | Section | Trust it? |
> | --- | --- |
> | §1–§7 catalogue | Mostly. The rule sets in §2 are **out of date** — the worker now also has `DAILY_SEND_CAP`, `CAP_EXEMPT`, three grouped preference toggles, and the types `player_absent`, `session_outcome`, `cover_offer`, `private_session_booked`. |
> | §8 gaps `G1`–`G14` | **Stale.** G1, G5, G8, G9, G12 are fixed; G3, G4 are open. See below. |
> | §9 missing `M1`–`M26` | Partly built: **M1** (`player_absent`) and **M12** (`cover_offer`) shipped. The rest stand. |
> | §10 briefings | **A proposal. Never built.** There is no morning briefing of any kind — see `notifications.md` §2a. |
> | §11 reasoning | Current and load-bearing. Read before arguing about adding or muting anything. |
> | §12 payload audit | **Stale in its headline finding** — see below. |
>
> **§12.5 is wrong now.** It reports `coach_confirm_nudge_2` and
> `coach_arrival_check` as having *zero rows ever*. Both began firing
> 2026-07-30 (18 and 23 rows). The five-rung coach ladder it describes as being
> two rungs in practice is now running in full. `waitlist_spot` is still at zero.
>
> **What §12.3 got right and is still true:** `client_coach_late` has never once
> been used (`coach_name` on 0 of 5 rows), `client_coach_arrived` falls back to
> free-form on most sends (16 of 54 carry `coach_name`), and `payment_failed`
> carries a genuinely empty payload so its template can never name the plan
> (G3). G4 — the waitlist template can never name the class — is untestable
> because the type has never fired.
>
> **For current status, read [`notifications.md`](notifications.md)** — what we
> send, what changed, and what is actually open.

Every message the academy sends or receives over WhatsApp, per role, with the
actual copy that goes out. Written to be **reviewed**, in six passes:

| | |
| --- | --- |
| §1–§7 | the catalogue — what is sent, to whom, with the real copy |
| §8 | what's wrong with what exists (`G*`) |
| §9 | what doesn't exist at all (`M*`) — the messages a table tennis academy needs and this system never sends |
| §10 | a redesign of the one message that exists and doesn't earn its place — the founder digest, and the morning briefings that should replace it |
| §11 | **why** each message exists — the job it does, who acts, what breaks without it |
| §12 | **what information** each message actually carries, audited against production payloads |

Read §11 before arguing about whether to add or mute anything; read §12 before
touching a template.

Sources of truth (read these before changing anything):

| Concern | File |
| --- | --- |
| Queueing (most messages) | `supabase/schema.sql` — RPCs + `ops_notify_*` triggers |
| Queueing (admin actions) | `lib/admin-ops*.ts`, `app/coach/**/actions.ts` |
| Timed prompts + delivery | `supabase/functions/notify/index.ts` |
| Template registry | `scripts/whatsapp/provision-templates.mjs` |
| Inbound buttons / words | `lib/whatsapp/interactive.ts` |
| Inbound free text (LLM) | `lib/whatsapp/agent.ts`, `lib/whatsapp/tools/*` |
| Webhook + identity | `app/api/whatsapp/route.ts`, `lib/whatsapp/identity.ts` |
| Transport | `lib/whatsapp/twilio.ts` |
| User-facing toggles | `lib/notification-prefs.ts` |

---

## 1. How a message gets to WhatsApp

Everything outbound is a row in `public.notifications`:

```
notifications(id, user_id, channel, type, title, body, data jsonb,
              scheduled_for, status pending|sent|failed, sent_at, read_at, created_at)
```

Nothing writes to Twilio directly except (a) the notify worker and (b) the
inbound webhook replying to a message the user just sent.

**The worker** (`supabase/functions/notify`, cron every minute) claims up to 100
rows where `status='pending' AND scheduled_for <= now()`, then for each row runs
this gauntlet in order:

1. **Dedupe within the batch** — key is `user_id : type : (booking_id ?? session_id ?? row id)`.
   Later rows win; earlier duplicates are marked `sent` without delivery.
2. **Feed-only?** 11 `ops_*` types are marked `sent` and never leave the DB —
   they render on `/admin` only (see §5).
3. **Quiet hours?** If the type is *deferrable* and "now" is inside IST
   `[21:30, 08:00)`, `scheduled_for` is pushed to the next 08:00 IST. Nothing is
   dropped, just held.
4. **Preferences?** Non-transactional types check
   `profiles.notification_prefs[type] === false` and are silently marked sent if off.
5. **Claim** — flip `pending → sent` first (idempotent across workers), then deliver.
6. **Deliver** — WhatsApp first, email second, else mark `failed`.

**Delivery inside `deliverWhatsApp`:**

| Path | Condition | What the member sees |
| --- | --- | --- |
| Interactive/CTA template | The type has a template AND its `TWILIO_WA_*_SID` env var is set | The approved template body with buttons. Works **any time** (business-initiated). Outbound Twilio SID is stored on `notifications.data.twilio_sid` so a button tap maps back to the session/booking. |
| Free-form text | User messaged us within 24h (`wa_messages` role=`user`) | `*{title}*` newline `{body}` |
| Generic utility template | Outside 24h, `TWILIO_WA_TEMPLATE_SID` set | One generic template, `{{1}}` = first name, `{{2}}` = `"{title} — {body}"` |
| Nothing | Outside 24h, no generic SID | `deliverWhatsApp` returns false → falls to email |

Then email via Resend, and — note — **if `RESEND_KEY` is unset the row is
counted as delivered** (`return true`) to avoid retry loops. A member with no
`wa_links` row and no Resend key gets nothing, silently.

**No `wa_links` row = no WhatsApp, ever.** Linking happens three ways: saving a
verified phone in the webapp (auto-linked on first inbound message by
`resolveIdentity`), approval (`review_signup_request` writes `wa_links`), or
messaging the bot from an unknown number (auto-provisions a client account).

### Timed prompts the worker generates itself

After the delivery loop, seven sweeps run (each isolated — one failure can't
break the others):

| Sweep | When | Creates |
| --- | --- | --- |
| `sweepWaitlistOffers` | offer unread for `waitlist_claim_minutes` (default 15) | next-in-line `waitlist_spot` |
| `sweepBeforeClass` | session starts in next 60 min | coach `coach_before_class` |
| `sweepCoachConfirmNudge` | T-30 → T-0, no confirm and no arrival | coach `coach_confirm_nudge_2` |
| `sweepArrivalCheck` | `[start-10min, start]`, no arrival | coach `coach_arrival_check` |
| `sweepFounderEscalations` | T-10 silent, or start+10 no arrival | founder `ops_coach_unconfirmed` / `ops_coach_not_arrived` |
| `sweepAfterClass` | within 2h of `ends_at` | coach `coach_after_class` |
| `sweepFounderDigest` | once per IST day at/after 21:00 | founder `ops_daily_digest` |

All are once-per-(user, session) via an `alreadyFired` existence check.

---

## 2. Delivery-rule sets (the three lists worth reviewing)

**`TRANSACTIONAL`** — ignore user preferences entirely:
`payment_failed`, `session_cancelled`, `signup_request`, `signup_approved`.

**`DEFERRABLE`** — held overnight to 08:00 IST:
`booking_confirmed`, `booking_rescheduled`, `coach_assigned`, `coach_changed`,
`role_changed`, `private_series_ended`, `private_minutes_low`, `payment_failed`,
`ops_daily_digest`, `time_off_requested`, `time_off_decision`, `signup_approved`.

Deliberately **not** deferrable (must fire at 2am if that's when they're due):
`reminder_upcoming`, `waitlist_spot`, `coach_before_class`, `coach_arrival_check`,
`coach_arrived`, `coach_late`, `signup_request`, all escalations.

**`FEED_ONLY`** — in-app `/admin` only, never WhatsApp/email:
`ops_booking`, `ops_cancellation`, `ops_attendance`, `ops_payment`,
`ops_membership`, `ops_new_client`, `ops_new_coach`, `ops_player_added`,
`ops_wa_linked`, `ops_credit_used`, `ops_coach_change`.

**User-facing toggles** (`lib/notification-prefs.ts`, shown in profile +
onboarding) cover only five types: `reminder_upcoming`, `waitlist_spot`,
`coach_changed`, `booking_rescheduled`, `renewal_upcoming`. Every other type is
unmutable by the member.

---

## 3. Client / parent messages

Examples show the **template render** where one exists, otherwise the
**free-form render** (`*Title*` + body). Placeholder cast: parent *Priya*, coach
*Augustine*, class *Beginners Batch*, venue *La Plazza*, `Sat 12 Jul, 6:30 pm`.

### 3.1 Booking lifecycle

**`booking_confirmed`** — queued by `_book_one`, `book_session`, `claim_waitlist_spot`.
Deferrable. No pref toggle. Template `client_booking_confirmed` (CTA).

> You're booked, Priya! Sat 12 Jul, 6:30 pm — Beginners Batch — see it anytime on your schedule.
> `[ View schedule ]`

Free-form fallback: `*Booked.*` / `Sat 12 Jul, 6:30 pm — Beginners Batch`

**`reminder_upcoming`** — the single consolidated reminder, queued at booking
time for `starts_at - 3 hours`. Deleted and re-queued on reschedule; deleted on
cancel. Pref: *Session reminders*. Template `client_session_reminder` (buttons).

> Hi Priya! Reminder: Beginners Batch is on today at 6:30 pm. See you at the table!
> `[ I'll be there ]` `[ Can't make it ]`

Free-form fallback is much thinner — `*Later today*` / `Beginners Batch`, **no
time at all** (the time lives in `data.time_str`, which only the template uses).

**`waitlist_spot`** — queued when a confirmed seat frees (`cancel_booking`,
`cancel_series`, `reschedule_booking`) and by the expiry sweep. Pref: *Waitlist
openings*. Template `client_waitlist_spot` (buttons).

> Good news Priya — a spot just opened in a class. First to claim it gets it (offer expires in 15 minutes).
> `[ Claim spot ]` `[ Pass ]`

Free-form: `*A spot opened*` / `Claim it within 15 minutes.`

**`booking_rescheduled`** — `reschedule_booking`, `reschedule_private_session`.
Deferrable, pref *Reschedule confirmations*. No template.

> *Rescheduled.*
> Sat 12 Jul 6:30 pm

**`session_cancelled`** — academy-side cancellation. Transactional (always
delivered). No template. Four different bodies:

- session cancelled: `*Session cancelled*` / `Beginners Batch — we're sorry. Your session allowance is unaffected.` (private: *Your minutes have been returned.*)
- class ended: `*Class ended*` / `Beginners Batch has finished its run. Your remaining sessions in it are cancelled — your allowance is unaffected.`
- all privates cancelled: `*Upcoming sessions cancelled*` / `Your upcoming private sessions have been cancelled — your minutes have been returned.`

**`session_moved`** — `moveSession` (admin). Not deferrable, no pref, no template.

> *Session moved*
> Beginners Batch is now Sat 12 Jul, 6:30 pm.

**`class_updated`** — `updateClass` (weekly class edited).

> *Class schedule changed*
> Beginners Batch has a new time or place — check your schedule.

### 3.2 Coach-related

**`coach_assigned`** — private occurrence created. Deferrable, no template.

> *You're on.* / `Coach confirmed for Sat 12 Jul 6:30 pm.`

…or, when no coach could be found:

> *We're confirming your coach* / `You'll hear from us within 24 hours.`

**`coach_changed`** — reassignment, dropout cover, private reschedule. Deferrable,
pref *Coach changes*, no template.

> *Meet your new coach*
> Your session has a new coach — say hello at the table.

**`coach_arrived`** — `coach_mark_arrival` (app tap, WhatsApp button, or geofence
auto). Sent to every `confirmed`/`attended` booking holder. Auto arrivals are
delayed 2 minutes so Undo beats delivery. Template `client_coach_arrived` (no buttons).

> Good news Priya — Coach Augustine has arrived at La Plazza for the 6:30 PM session.

**`coach_late`** — same RPC with `p_late`. Template `client_coach_late`.

> Hi Priya — Coach Augustine is running a few minutes late for the 6:30 PM session. They're on their way.

### 3.3 Money and membership

**`payment_failed`** — subscription flips to `past_due`. Transactional **and**
deferrable. Template `client_payment_issue` (CTA).

> Hi Priya, your last payment for your membership didn't go through. Please update your payment method to keep sessions running.
> `[ Fix payment ]`

The free-form body names the actual plan (`Your Monthly Group payment didn't go
through…`); the template can't — see gap **G3**.

**`private_series_ended`** — plan lapsed, weekly private slot retired. Deferrable.

> *Weekly sessions ended*
> Your weekly private slot ended with your plan. Renew to keep the slot.

**`private_minutes_low`** — weekly slot couldn't be booked, throttled to once per
3 days per series. Deferrable.

> *Weekly session paused*
> Not enough private minutes to book your next weekly session — it resumes when your plan renews.

### 3.4 Access and broadcast

**`signup_approved`** — founder approved a closed-membership request.
Transactional + deferrable. Template `client_signup_approved` (CTA).

> Great news Priya — your Sharwin TTA membership request is approved. Tap below to set up your family and book your first session.
> `[ Open the app ]`

**`announcement`** — founder broadcast to all clients or all coaches, via
`/admin` or the `broadcast_message` bot tool. No template, not deferrable, no pref.

> *Message from the academy*
> Saturday sessions move indoors this week.

**`new_private_session` (client copy)** — an academy-booked private. See gap **G1**:
this renders through the *coach* template.

> *Private session booked*
> We've set up a private session for Sat 12 Jul, 6:30 pm — it's on your schedule.

---

## 4. Coach messages

### 4.1 The class-day sequence (the core coach flow)

| Time | Type | Message | Buttons |
| --- | --- | --- | --- |
| T-60 | `coach_before_class` | Hi Augustine! Beginners Batch starts at 6:30 pm at La Plazza. Are you coming? | `Yes, I'm coming` / `Can't make it` |
| T-30 | `coach_confirm_nudge_2` | *Quick check* — are you coming to Beginners Batch at 6:30 pm? The founder gets alerted in 20 minutes if we haven't heard. | none (plain text) |
| T-10 | — | *founder* is escalated (`ops_coach_unconfirmed`) | — |
| T-0 | `coach_arrival_check` | Hi Augustine! Beginners Batch is starting. Have you reached La Plazza? | `I've arrived` / `Running late` |
| T+10 | — | *founder* is escalated (`ops_coach_not_arrived`) | — |
| after end | `coach_after_class` | 🎉 Great work wrapping up *Beginners Batch*! Up next today: Improvers at 7:30 pm. Please confirm today's attendance and add a quick assessment note for each student here: `<link>` — thank you! 🙌 | `All present` / `Some absent` |

Notes worth reviewing:

- T-30 and T-0 are skipped once `coach_confirmed_at` / `coach_arrived_at` is set
  by any surface (app, bot, geofence).
- Tapping *arrived* also stamps `coach_confirmed_at` — a coach who only ever taps
  "arrived" is never nagged or escalated.
- The after-class message has no next class → `That's all your classes today —
  brilliant work, enjoy the rest of your day! 🎉`
- Changing a session's coach or start time resets both stamps
  (`reset_session_confirmation`), so the whole sequence re-arms.

### 4.2 Schedule changes

| Type | Trigger | Message |
| --- | --- | --- |
| `new_private_session` | private created / rescheduled | Template: *New private session, Augustine: Sat 12 Jul 6:30 pm — 21 MG Road. Tap below for the address and details.* `[ View session ]` |
| `coach_changed` | reassigned away | *Session reassigned* / One of your sessions was moved to another coach. |
| `coach_changed` | assigned to | *New session assigned* / A session was added to your calendar. |
| `coach_changed` | auto-cover after a dropout | *You picked up a session* / Cover assigned to you automatically. |
| `coach_changed` | private moved away | *Session moved* / A private session was rescheduled away from you. |
| `session_cancelled` | client cancelled a private | *Private session cancelled* / The Sat 12 Jul 6:30 pm private session was cancelled by the client. |
| `session_cancelled` | founder cancelled a session | *Session cancelled* / Beginners Batch |
| `session_cancelled` | class ended | *Class ended* / Beginners Batch has ended — its sessions are off your calendar. |
| `session_moved` | session moved | *Session moved* / Beginners Batch — now Sat 12 Jul, 6:30 pm. (or *Session moved off your calendar* / …the new time clashed for you) |
| `class_updated` | weekly class edited | *Class schedule changed* / Beginners Batch moved — check your calendar. |
| `session_booked` | class restored | *Class restored* / Beginners Batch is back on — its sessions are on your calendar again. |

### 4.3 Status and admin

**`role_changed`** — client promoted to coach. Deferrable.

> *You're a coach now*
> Message me any time for your schedule, rosters and availability.

**`time_off_decision`** — founder approved/rejected. Deferrable.

> *Time off approved* / `Your sessions in the range are being covered.`
> *Time off rejected* / `Talk to the founder if you need this changed.`

Plus `announcement` (coach audience).

---

## 5. Founder messages

The founder's WhatsApp is deliberately **escalations + one daily digest**.
Everything routine is in-app.

### 5.1 In-app only (`FEED_ONLY`) — never sent to WhatsApp

These render on `/admin` and are counted in the 21:00 digest.

| Type | Title(s) | Example body |
| --- | --- | --- |
| `ops_booking` | New booking / Waitlist join / Booking rescheduled / Waitlist spot claimed | `Priya Sharma (Aarav) booked Beginners Batch — Sat 12 Jul, 6:30 pm at La Plazza · now 6/8.` |
| `ops_cancellation` | Booking cancelled | `Priya Sharma (Aarav) cancelled Beginners Batch — Sat 12 Jul, 6:30 pm. Reason: in_window.` |
| `ops_attendance` | Attendance marked / No-show | `Aarav did NOT show for Beginners Batch (Sat 12 Jul, 6:30 pm).` |
| `ops_payment` | Payment received / One-off purchase | `₹4500 from Priya Sharma — Monthly Group renewal.` |
| `ops_membership` | New membership / recovered / cancelled / paused | `Priya Sharma started Monthly Group (₹4500/mo).` |
| `ops_new_client` | New client signed up | `Priya Sharma (priya@example.com, +919812345678) just created an account.` |
| `ops_new_coach` | New coach joined | `Augustine Rao (…) is now on the coach roster.` |
| `ops_player_added` | Player added | `Priya Sharma added Aarav to their household.` |
| `ops_wa_linked` | WhatsApp linked | `Priya Sharma linked WhatsApp (+919812345678).` |
| `ops_credit_used` | Free trial used / Drop-in used | `Priya Sharma (Aarav) booked their FREE TRIAL class.` |
| `ops_coach_change` | Coach assigned / Session needs cover | `Beginners Batch — Sat 12 Jul, 6:30 pm: unassigned → Augustine Rao.` |

Anti-flood rules already in place: series bookings notify only on the first
occurrence; sweep-marked attendance (no `auth.uid()`) stays silent; coach changes
only for sessions inside the next 7 days; the auto-created signup player is skipped.

### 5.2 Delivered to the founder's WhatsApp

**`ops_daily_digest`** — 21:00 IST, once per IST day, nothing sent on a quiet day.
Deferrable. Template `founder_daily_digest` (CTA).

> Today at the academy (2026-07-29): 12 bookings · 2 cancellations · 1 new client
> `[ Open dashboard ]`

**`signup_request`** — closed-membership application. Transactional, **not**
deferrable (the applicant is waiting on the pending screen). Template
`founder_signup_request` (buttons).

> New signup request from Priya Sharma — email priya@example.com, phone +919812345678. Approve access to the academy?
> `[ Approve ]` `[ Deny ]`

**`ops_coach_unconfirmed`** — T-10, coach fully silent.

> *Coach hasn't confirmed*
> Augustine Rao still hasn't confirmed they're coming to Beginners Batch (Sat 12 Jul, 6:30 pm) — it starts in ~10 min. A nudge or a backup plan may be worth it. (+919812345678)

**`ops_coach_not_arrived`** — start+10, no arrival. Copy branches on whether they
had confirmed:

> *Coach not marked arrived*
> Augustine Rao confirmed they were coming to Beginners Batch (Sat 12 Jul, 6:30 pm) but hasn't marked arrival 10+ minutes in — call them now. (+919812345678)

> Beginners Batch (Sat 12 Jul, 6:30 pm) is 10+ minutes in and Augustine Rao never responded at all today — likely a no-show, act now. (+919812345678)

**`coach_late`** (founder copy — no `coach_name` in data, so free-form not template)

> *Coach running late*
> Coach Augustine is running a few minutes late for the 6:30 PM session.

**`session_unassigned`**

> *Session needs a coach* / No coach fits this slot — resolve it in the calendar.
> *Cover needed* / A coach dropped a session and no substitute fits.

**`private_request_parked`**

> *Private request parked* / A private request has no available coach — resolve manually.

**`session_issue`** — coach tapped "report a problem".

> *Coach reported a problem* / Open the session to follow up.

**`time_off_requested`** — deferrable.

> *Time-off request* / A coach requested time off — review it.

**`ops_payment_issue`** — see gap **G2** (an `ops_*` type that is *not* feed-only).

> *Payment past due* / Priya Sharma's Monthly Group payment failed — Razorpay is retrying; grace period applies.

**`ops_private_series_paused`** — also not feed-only (**G2**).

> *Private series paused* / A weekly private slot could not be booked (insufficient minutes).

---

## 6. Inbound — what the bot does with a reply

`app/api/whatsapp/route.ts`: validates `X-Twilio-Signature`, acks Twilio with
empty TwiML immediately, then does the work in `after()`. Identity is resolved
phone-first (`wa_links` → unique `profiles.phone` → auto-provision a client
account). A **real Supabase session is minted for that user**, so RLS — not the
LLM — is the security boundary. Rate limit: 12 inbound user messages/minute.

Order of handling: **deterministic action → assistant**.

### 6.1 Button ids and what they run

| Button id | Title | Role | Runs |
| --- | --- | --- | --- |
| `coach_confirm` | Yes, I'm coming | coach | `coach_confirm_session` |
| `coach_cant` | Can't make it | coach | arms a 2-step confirm; a `YES` within 30 min runs `handle_coach_dropout` |
| `coach_arrived` | I've arrived | coach | `coach_mark_arrival(p_late=false, p_source='wa')` |
| `coach_late` | Running late | coach | `coach_mark_arrival(p_late=true)` |
| `ac_present` | All present | coach | all `confirmed` bookings → `attended` |
| `ac_absent` | Some absent | coach | numbered roster prompt → digits reply |
| `rem_yes` | I'll be there | client | acknowledgement only |
| `rem_no` | Can't make it | client | `cancel_booking` |
| `wl_claim` | Claim spot | client | `claim_waitlist_spot` |
| `wl_pass` | Pass | client | marks the offer read |
| `su_approve` | Approve | founder | `review_signup_request(approve=true)` |
| `su_deny` | Deny | founder | `review_signup_request(approve=false)` |

### 6.2 Matching rules (asymmetric on purpose)

- **Coach**: tapped id, exact button title, *or* a loose one-word reply matched
  on the whole message — `coming`, `confirm`, `confirmed`, `arrived`, `reached`,
  `running late`, `late`, `present`, `absent`. "running late for the airport"
  does **not** match.
- **Client**: tapped id only, or an exact title *paired with* the replied-to
  message SID. A stray "pass" in conversation never acts.
- **Founder**: same strictness as client (`approve`/`deny`).

Session resolution for a coach tap: `OriginalRepliedMessageSid` →
`notifications.data.twilio_sid` → `session_id`. Falls back to the coach's nearest
session for that phase — before-class window `[-45min, +120min]`, after-class
`[-6h, +30min]`.

### 6.3 Reply copy (deterministic paths)

| Action | Bot replies |
| --- | --- |
| coach confirms | `✅ Thanks Augustine — you're confirmed. See you there!` |
| coach can't make it | `Are you sure you can't make Beginners Batch at 6:30 pm? Reply YES to confirm — we'll arrange cover.` |
| …then YES | `Thanks for letting us know — we're arranging cover so you're off this session.` |
| coach arrived | `📍 Marked you as arrived — the parents have been notified. Have a great session!` |
| coach late | `🏃 Thanks for the heads-up — we've let everyone know you're running a little late.` |
| all present | `✅ Marked all 6 students present. Don't forget to add a quick assessment note for each: <link>` |
| some absent | `Who was absent? Reply with the numbers (e.g. "2 4") — or 0 if everyone made it after all.` + `1 Aarav · 2 Diya · 3 Ishaan` |
| absent digits | `Marked Diya absent, 5 present ✅` (or `Great — marked all 6 present ✅`) |
| client "I'll be there" | `See you there! 🏓` |
| client "Can't make it" | `Done — that spot's been freed up. Want to rebook another time? <link>` |
| client claims spot | `🎉 You're in! The spot is yours — see it on your schedule.` |
| spot already taken | `Ah — that spot was just taken. We'll let you know if another opens up.` |
| client passes | `No problem — we'll offer it to the next family.` |
| founder approves | `Approved ✅ — Priya Sharma has been sent the onboarding link.` |
| founder denies | `Denied — they won't be notified.` |
| already handled | `Already handled.` |
| unresolvable session | `Thanks! I couldn't tell which session that was for though — which class did you mean? You can also update it in the app.` |

The "some absent" prompt is stored on the after-class notification row
(`data.absent_prompt` = ordered booking ids) and expires after 2 hours; the
"can't make it" arm expires after 30 minutes and is single-shot.

### 6.4 Free text → the assistant

Anything not matched above goes to Gemini (`gemini-2.5-flash` via Vertex) with a
role-scoped tool list. History is the last 24 rows of `wa_messages`. Max 8 tool
rounds. Destructive actions require an explicit "yes" first (per the system
prompt), except a founder giving a complete, unambiguous booking instruction.

| Role | Tools | Coverage |
| --- | --- | --- |
| guest | 1 | `get_academy_info` (rare — unknown numbers are auto-provisioned to `client`) |
| client | 16 | schedule, browse/book/cancel/reschedule group, private availability + booking, membership status, plans and one-off products, payment links, profile, players |
| coach | 12 | sessions, confirm, mark arrival, roster, availability windows, time off, attendance, notes, can't-make-session |
| founder | 44 | classes, sessions, coaches, clients, venues, settings, subscriptions, dunning, comps, credits, broadcast, time-off decisions |

Failure copy: bad signature → 403; media-only → `I can only read text messages
for now — type what you need!`; rate limited → `You're messaging faster than I
can think — give me a minute 🙂`; identity failure → `I'm having trouble
reaching your account right now — please try again in a minute.`

---

## 7. Template registry

Provisioned by `npm run wa:provision` (idempotent, submits each as **UTILITY**).
Button ids must stay in sync with `interactive.ts`; variable order must stay in
sync with `interactiveContentFor()` in the worker.

| Env var | Template | Type | Used by | Vars |
| --- | --- | --- | --- | --- |
| `TWILIO_WA_COACH_COMING_SID` | `coach_coming_check` | quick-reply | `coach_before_class` | name, class, "6:30 pm at La Plazza" |
| `TWILIO_WA_COACH_ARRIVAL_SID` | `coach_arrival_check` | quick-reply | `coach_arrival_check` | name, class, venue |
| `TWILIO_WA_COACH_AFTERCLASS_SID` | `coach_class_complete` | quick-reply | `coach_after_class` | class, next-sentence, url |
| `TWILIO_WA_COACH_PRIVATE_SID` | `coach_private_session` | CTA | `new_private_session` | name, when+address, session id |
| `TWILIO_WA_CLIENT_REMINDER_SID` | `client_session_reminder` | quick-reply | `reminder_upcoming` | name, class, time |
| `TWILIO_WA_CLIENT_WAITLIST_SID` | `client_waitlist_spot` | quick-reply | `waitlist_spot` | name, class, minutes |
| `TWILIO_WA_CLIENT_PAYMENT_SID` | `client_payment_issue` | CTA | `payment_failed` | name, plan |
| `TWILIO_WA_CLIENT_BOOKED_SID` | `client_booking_confirmed` | CTA | `booking_confirmed` | name, when+class |
| `TWILIO_WA_CLIENT_ARRIVED_SID` | `client_coach_arrived` | text | `coach_arrived` | name, coach, venue, time |
| `TWILIO_WA_CLIENT_LATE_SID` | `client_coach_late` | text | `coach_late` | name, coach, time |
| `TWILIO_WA_CLIENT_APPROVED_SID` | `client_signup_approved` | CTA | `signup_approved` | name |
| `TWILIO_WA_FOUNDER_DIGEST_SID` | `founder_daily_digest` | CTA | `ops_daily_digest` | date, summary |
| `TWILIO_WA_FOUNDER_SIGNUP_SID` | `founder_signup_request` | quick-reply | `signup_request` | name, email, phone |
| `TWILIO_WA_COACH_REMINDER_SID` | `coach_class_reminder` | quick-reply | **unused** — superseded by `coach_coming_check` | |
| `TWILIO_WA_TEMPLATE_SID` | *(generic utility)* | — | any type with no template, outside the 24h window | first name, "title — body" |

Note the generic `TWILIO_WA_TEMPLATE_SID` template is **not** created by the
provisioning script — it must be built and approved by hand.

**Types with no template at all** (free-form inside 24h, generic template
outside, else email): `coach_confirm_nudge_2`, `coach_changed`, `coach_assigned`,
`booking_rescheduled`, `session_cancelled`, `session_moved`, `class_updated`,
`session_booked`, `role_changed`, `time_off_requested`, `time_off_decision`,
`private_series_ended`, `private_minutes_low`, `announcement`,
`session_unassigned`, `private_request_parked`, `session_issue`,
`ops_coach_unconfirmed`, `ops_coach_not_arrived`, `ops_payment_issue`,
`ops_private_series_paused`, founder-copy `coach_late`.

---

## 8. Review checklist — gaps found while writing this

Ordered roughly by impact. Each is a claim to verify, not a confirmed decision.

**G1 — A client can receive a coach-worded message with a coach link.**
`lib/admin-ops-calendar.ts` queues `new_private_session` for **both** the client
and the coach. `interactiveContentFor()` maps that type unconditionally to
`TWILIO_WA_COACH_PRIVATE_SID`, whose CTA points at `/coach/session/<id>`. A
parent booking an academy-arranged private gets *"New private session, Priya: …
Tap below for the address and details."* with a coach deep link they can't open.
Fix is either a distinct client type or a `data`-based gate (the way
`coach_arrived` gates on `coach_name`).

**G2 — Two `ops_*` types leak to the founder's WhatsApp.**
`ops_payment_issue` and `ops_private_series_paused` are named like feed items but
are in neither `FEED_ONLY` nor `OPS_DIGEST_LABELS`. They therefore ping WhatsApp
immediately *and* are invisible in the daily digest counts. Decide which they
are: escalation (rename, keep sending) or feed (add to both lists).

**G3 — The payment-failed template can never name the plan.**
The insert in `ops_notify_subscription` builds `data` as `{url}` only, so the
template's `{{2}}` always falls back to *"your membership"* even though `body`
has the plan name. One extra key in `jsonb_build_object` fixes it.

**G4 — The waitlist template can never name the class.**
Same shape: no `class_title` or `claim_minutes` in `data` at any of the four
insert sites, so every offer reads *"a spot just opened in a class"* with a
hardcoded 15 minutes. If the real claim window is configured differently in
`settings`, the message is also wrong.

**G5 — The free-form reminder drops the time.**
`reminder_upcoming` renders as `*Later today*` / `Beginners Batch` when the
template isn't used. Members who messaged us recently (in-window) get the *worse*
message. Consider putting the time in `body`.

**G6 — `renewal_upcoming` is a toggle with no sender.**
It is offered in the profile and onboarding preference lists but nothing anywhere
inserts a notification of that type. Either build it or drop the toggle.

**G7 — Quiet hours don't cover several member-facing types.**
`session_moved`, `class_updated`, `session_cancelled`, `announcement`,
`session_issue`, `session_unassigned` and `private_request_parked` are not in
`DEFERRABLE`. A founder editing a class at 23:00 pings every booked parent.
Cancellations arguably *should* be immediate; a schedule tweak probably shouldn't.

**G8 — Silent drops when Resend is unconfigured.**
`deliver()` returns `true` when `RESEND_KEY` is unset, so a member with no
`wa_links` row never receives anything and the row still reads `sent`. There is
no metric distinguishing "delivered" from "given up on".

**G9 — Members can only mute 5 of ~30 types.**
`PREF_TYPES` covers reminders, waitlist, coach changes, reschedules and the
non-existent renewal notice. Booking confirmations, arrivals, moves, class
updates and broadcasts have no toggle.

**G10 — Batch dedupe can swallow a legitimate second message.**
The key is `(user, type, booking/session)`. Two `coach_changed` rows for the same
session (old coach removed, new coach added) can't collide — different users —
but a client with two players in one session gets one `session_moved`, which is
probably right, and one `coach_arrived`, also right. Worth confirming no
per-player message is being lost.

**G11 — Coaches get no day-ahead view.**
The coach flow is entirely per-session (T-60 onward). There is no "here's your
day" morning message, and no client reminder earlier than 3 hours before.

**G12 — Unused template still provisioned.**
`coach_class_reminder` (the 3-button version that re-introduced "arrived" at
T-60) is still created and submitted for approval on every `wa:provision` run,
and its env var is still printed in the setup instructions.

**G13 — Escalations aren't in the digest.**
`sweepFounderDigest` counts only `FEED_ONLY` types. A day with three coach
no-shows shows nothing about them in the 21:00 summary.

**G14 — Free-form fallback loses all buttons.**
Inside the 24h window the worker prefers the template (good), but any type whose
SID is unset degrades to text with no affordance — the coach `coach_confirm_nudge_2`
prompt, for example, invites no reply words at all, unlike its T-60 sibling.

### Things that are already handled well (don't "fix" these)

- Series bookings notify the founder once, not once per week.
- Auto-marked attendance (no acting user) stays silent.
- Coach changes only surface for sessions in the next 7 days.
- Arrival auto-detection delays parent messages 2 min so Undo wins.
- `coach_confirm_session` deliberately does **not** ping the founder.
- Coaches get loose word matching; clients and the founder deliberately do not.
- Reminders are swept on cancel and re-queued on reschedule.
- Interactive templates bypass the 24h window entirely.
- Approving a signup writes `wa_links`, so the approval message can actually land.
- School players (no account) are skipped everywhere a notification loops over bookings.

---

## 9. Missing notifications — what an academy still needs

§8 lists things that are wrong. This section lists things that **aren't there at
all**: events the product already models in the database, and that a table tennis
academy's three audiences genuinely need, but which currently notify nobody.

Each item is verified against the code — "missing" means grep-confirmed absent,
not assumed. IDs are `M*` so they don't collide with the `G*` gaps above.

### 9.0 What each role actually needs

The catalogue above grew message-by-message, so it covers **transactions**
(booked, moved, cancelled) very well and **outcomes** (did it happen, was it any
good, was it worth the money) barely at all. That's the shape of the gap.

**The client is a parent, not a player.** They rarely see the session. They drop
a child at La Plazza and leave. Their questions, in order of how much they care:
*Did my child actually get there and take part? Are they getting better? What am
I paying, and when? When's the next one?* The system answers only the last. It
tells them a booking exists and — when a card fails — that money broke. It never
once tells them their child turned up, learned something, or improved. For a
₹4,500/month product sold on coaching quality, that is the central omission: the
academy is silent about the only thing it's selling.

**The coach is peripatetic and paid per session.** They move between a venue, a
school and private addresses. Their questions: *Where am I today and in what
order? Who am I about to teach? What do I still owe the academy? What work is
available?* Today they learn about each session 60 minutes before it starts,
which is too late to plan travel, and they walk in without a roster. Every coach
message is a *prompt to act now* — none is *information to plan with*.

**The founder runs a small business on thin margins.** Escalations and the
digest cover *today is on fire*. Nothing covers *this month is drifting*: a
family that quietly stopped coming, a class running at 3/8, a trial that never
converted, revenue for the week. The daily digest counts **events**, never
**money** and never **risk** — so the system is excellent at incidents and blind
to churn.

### 9.1 Priority

| ID | Missing message | Audience | Trigger | Why it matters |
| --- | --- | --- | --- | --- |
| **M1** | Child marked absent / no-show | client | attendance marked `no_show` | A minor didn't arrive and nobody tells the parent. Duty of care, not admin. |
| **M2** | Free trial granted | client | `grant_signup_trial` | Trial credit is created in silence; the funnel starts with nobody knowing they have one. |
| **M3** | Trial unused nudge | client | trial credit 3 / 10 days old, unconsumed | Direct revenue leak on the main acquisition path. |
| **M4** | Post-trial conversion | client | trial credit consumed + 1 day | The one moment a family is warmest and we say nothing. |
| **M5** | Payment received / receipt | client | `invoices.status → paid`, `orders → paid` | Money only ever generates a message when it **fails**. |
| **M6** | Renewal upcoming | client | `current_period_end − 3 days` | Toggle already exists with no sender (**closes G6**); also prevents most `payment_failed`. |
| **M7** | Membership paused / cancelled / resumed | client | `ops_notify_subscription` branches | Founder is told about every branch; the member about none. |
| **M8** | Progress / assessment shared | client | `skill_assessments` insert | The product's core value is write-only — parents never see it. |
| **M9** | Monthly progress summary | client | monthly, per player | The retention artefact. Turns a subscription into a story. |
| **M10** | Coach day-ahead schedule | coach | 07:30 IST daily | **Closes G11.** T-60 per session is unusable for travel planning. |
| **M11** | Roster on the pre-class message | coach | extend `coach_before_class` | Coach walks in not knowing who or how many are coming. |
| **M12** | Cover offer broadcast | coach | `session_unassigned` fires | Fastest fix for the exact problem the founder is escalated about. |
| **M13** | Outstanding assessments chase | coach | weekly, `get_pending_assessments` | The backlog is already modelled and nothing ever chases it — M8/M9 depend on it. |
| **M14** | At-risk / churn signal | founder | 2 no-shows, or 14 days idle on an active plan | Highest-value message in the business; entirely absent. |
| **M15** | Capacity & utilisation | founder | weekly | Open a batch / kill a batch is the core supply decision. Data is all there. |
| **M16** | Money in the digest | founder | extend `sweepFounderDigest` | Digest counts payments, never totals them. |
| **M17** | Trial conversion report | founder | weekly | Measures M2–M4; the funnel is currently unobservable. |
| **M18** | Weekly rollup | founder | Sunday evening | Only a daily digest exists; academies run on weekly rhythms. |
| **M19** | Waitlist join acknowledgement | client | `_book_one` returns `waitlisted` | Joining a waitlist is completely silent — no ack, no position. |
| **M20** | Private minutes expiring | client | `expire_credits` − 3 days | Balances are zeroed at period end with **no warning at all**. |
| **M21** | Day-before reminder | client | 18:00 IST the evening before | T-3h (3:30pm for a 6:30pm class) is too late to arrange a lift. |
| **M22** | Invite delivered | client / coach | `client_invites`, `coach_invites` insert | We store a phone number and then never message it. |
| **M23** | Welcome / first-session prep | client | first confirmed booking | What to bring, where to park, when to arrive. Absent. |
| **M24** | Time-off request received | coach | `coach_time_off` insert | Founder is told; the requesting coach gets no ack until a decision. |
| **M25** | Roster churn | coach | student joins/leaves their class | Coaches can't see who's new or who left. |
| **M26** | Birthday / milestone | client | `players.date_of_birth` | Cheap goodwill; DOB is already stored and unused. |

---

### 9.2 Client — the missing messages

#### M1 · `attendance_missed` — the most important one

`ops_notify_booking_status` handles `no_show` by calling `notify_founders` and
nothing else. A child booked into Beginners Batch who never walks in produces an
`/admin` feed row and **total silence to the parent**. The parent believes their
child is at the table.

This is the only proposed message that is a safety concern rather than a
marketing one, and it should be **transactional** (ignores prefs) and **not
deferrable** (fires whenever marked).

> *Aarav wasn't at today's class*
> We marked Aarav absent for Beginners Batch (Sat 12 Jul, 6:30 pm). If that's a
> mistake or something's up, just reply here — we'll sort it.

Reply handling is free — the LLM already fields client free text.

Consider a matching positive on the same trigger (`attended`), folded into M8 so
a family gets **one** message after a session, not two.

#### M2–M4 · The trial funnel (three messages, currently zero)

`grant_signup_trial` inserts a `group_trial` credit on every new client profile.
Nothing announces it. `ops_notify_credit_used` reports consumption **to the
founder only**. So the academy's main acquisition path runs end-to-end without a
single message to the person being acquired.

**M2 — granted**, right after signup:

> Welcome to Sharwin TTA, Priya! You've got a **free trial class** waiting —
> pick any group session that suits you and it's on us.
> `[ Book my free class ]`

**M3 — unused**, at day 3 and day 10 (then stop):

> Hi Priya — your free trial class at Sharwin TTA is still unclaimed. Saturdays
> at 6:30 pm are our most popular beginners slot. Want us to hold a spot?
> `[ See class times ]`

**M4 — after the trial**, ~24h after the session (and only if they haven't
already subscribed):

> Hope Aarav enjoyed their first session with Coach Augustine, Priya! If they'd
> like to keep going, our Monthly Group plan is ₹4,500/month for weekly coaching.
> `[ See plans ]` `[ Talk to us ]`

M4 should be suppressed when a subscription already exists — check
`has_active_subscription(client_id)` at send time, not at queue time.

#### M5–M7 · Money in the *good* direction

Today the only money message a client can ever receive is `payment_failed`. Both
`ops_notify_invoice` and `ops_notify_order_paid` notify the founder and stop.

**M5 — receipt** (`payment_received`), on `invoices → paid` / `orders → paid`:

> *Payment received — thank you!*
> ₹4,500 for Monthly Group. You're covered through 5 Aug. Invoice in the app.

**M6 — renewal upcoming**, 3 days before `current_period_end`. `renewal_upcoming`
is already in `PREF_TYPES` and in the profile UI with **nothing inserting it**
(G6). Building the sender is strictly better than removing the toggle: a heads-up
is the cheapest prevention for the `payment_failed` path that already exists.

> *Renewing soon*
> Your Monthly Group plan renews on 5 Aug — ₹4,500. Nothing to do if your card's
> still good.

**M7 — membership lifecycle** (`membership_changed`). `ops_notify_subscription`
already branches on `paused`, `canceled`, and recovery, and tells the founder
each time. Mirror the three that the member can feel:

> *Membership paused* / Your Monthly Group plan is paused. Your slot is held —
> tell us when you'd like to restart.
> *Membership ended* / Your Monthly Group plan has ended. Your upcoming sessions
> have been released. You're welcome back any time.
> *You're all set again* / Payment went through — your membership is active and
> your sessions are back on.

#### M8–M9 · Progress — the value the academy is actually selling

`skill_assessments` + `skill_ratings` (1–5 per skill) and `student_notes` are
fully built. Coaches are actively nudged to fill them in after **every** class
(`coach_after_class` links straight to the form). `get_pending_assessments`
even tracks a 7-day backlog.

Grep confirms **nothing anywhere notifies the parent**. The entire assessment
system is write-only. A parent paying monthly for coaching has no idea their
child is being assessed at all.

**M8 — after an assessment is filed** (throttle: at most one per player per
week, and hold it a couple of hours so it doesn't race the coach's typing):

> *Aarav's session notes are in* 🏓
> Coach Augustine worked on backhand push and service return today, and moved
> Aarav up to 3/5 on footwork. Full notes on their profile.
> `[ See Aarav's progress ]`

**M9 — monthly summary**, first week of each month, per player:

> *Aarav's month at the academy*
> 4 of 4 sessions attended. Improved on 3 skills — biggest jump: backhand push
> (2 → 4). Coach Augustine says: "Much more confident on the return."
> `[ Full progress report ]`

M9 is the single strongest retention message available to this product, and it's
composed entirely from data that already exists. It also creates the pull that
makes M13 (chasing coaches for assessments) worth doing.

#### M19–M21, M23, M26 · The smaller ones

**M19 — waitlist join.** `_book_one` inserts a `waitlisted` booking with a
computed `waitlist_position` and queues no notification. The founder sees
"Waitlist join"; the family sees nothing and doesn't know whether the tap worked.

> *You're on the waitlist*
> Aarav is #2 for Beginners Batch, Sat 12 Jul 6:30 pm. We'll message you the
> moment a spot opens — first to claim it gets it.

**M20 — minutes expiring.** `expire_credits` zeroes the whole private-minutes
balance at `current_period_end` for `canceled`/`past_due` subscriptions, with no
warning and no notification. Money silently disappearing is the worst kind of
silence. (Group `class_credits` have no expiry — this is private minutes only.)

> *Your private minutes expire soon*
> You've got 120 private minutes left, and they expire on 5 Aug when your plan
> ends. Book them in while you can.

**M21 — day-before reminder.** The consolidated `reminder_upcoming` fires at
`starts_at − 3h`. For an evening class that lands mid-afternoon — too late for a
working parent to arrange a lift. Add an 18:00 IST evening-before nudge for
next-day sessions, sharing the `reminder_upcoming` pref toggle (one toggle, two
sends — don't add a second mutable type).

**M23 — welcome / first-session prep**, on a family's *first* confirmed booking.
Nothing today distinguishes a first booking from a fiftieth:

> *See you Saturday!*
> First session for Aarav: Beginners Batch, Sat 12 Jul 6:30 pm at La Plazza.
> Come 10 minutes early, bring water and indoor shoes — bats and balls are on us.
> Parking is on the left of the building.

**M26 — birthday.** `players.date_of_birth` is stored and used for nothing but
age. One warm message a year costs nothing. Low priority, genuinely liked.

---

### 9.3 Coach — the missing messages

#### M10 · Day-ahead schedule (closes G11)

Every coach message today is per-session and starts at T-60. A coach travelling
between La Plazza, a school and a private address at 21 MG Road cannot plan a
day from a sequence of one-hour warnings. One message at 07:30 IST:

> *Your day — Sat 12 Jul* 🏓
> 4:00 pm · Beginners Batch · La Plazza (6 booked)
> 6:30 pm · Improvers · La Plazza (8 booked, 2 waitlisted)
> 8:00 pm · Private — Aarav S. · 21 MG Road
> Reply if anything here looks wrong.

Deferrable is irrelevant (07:30 is outside quiet hours by design). Send nothing
on a day with no sessions.

#### M11 · Put the roster on the pre-class message

`coach_before_class` currently renders *"Beginners Batch starts at 6:30 pm at La
Plazza. Are you coming?"* — no headcount, no names. The roster only ever appears
**after** class, in the absent-marking prompt. So a coach cannot greet a new
student by name, or notice that three of six cancelled.

Prefer extending the existing template (add a variable) over a new type — one
message with the count, and names on request:

> Hi Augustine! Beginners Batch starts at 6:30 pm at La Plazza — 6 students,
> 1 new. Are you coming?
> `[ Yes, I'm coming ]` `[ Can't make it ]`

Flagging **new** students matters: first impressions are what convert a trial
(M4) into a subscription.

#### M12 · Cover offers — the highest-leverage missing message

When `session_unassigned` or `handle_coach_dropout` fires, **only the founder is
told**. The founder then chases coaches by hand. The system already knows which
coaches are eligible — `rank_coaches`, `coach_filter_failure` and
`coach_availability` exist precisely for this — so the fix for the escalation
could be broadcast automatically to the people who can resolve it.

> *Cover needed — Sat 12 Jul, 6:30 pm*
> Improvers at La Plazza needs a coach. It's in your usual availability.
> `[ I'll take it ]` `[ Not free ]`

First tap wins (mirror the `claim_waitlist_spot` race handling exactly —
including the "just taken" reply). Escalate to the founder only if nobody claims
it within N minutes. This turns two founder escalations
(`session_unassigned`, `ops_coach_not_arrived`) from *problems to solve* into
*problems already being solved*.

#### M13 · Chase outstanding assessments

`get_pending_assessments` returns every attended booking in the last 7 days with
no assessment filed. It is used to render a screen. Nothing ever pushes it.

> *3 assessments to finish*
> You've got notes outstanding for Aarav, Diya and Ishaan from this week.
> Two minutes each: `<link>`

Weekly, one message, only when the count is non-zero. M8 and M9 are worthless if
the underlying assessments are never written — this is the message that makes
the parent-facing progress reports possible.

#### M24–M25 · Acknowledgements and roster churn

**M24 — time-off received.** A coach files time off; `time_off_requested` goes to
the founder; the coach hears nothing until a decision lands. One-line ack:

> *Time-off request received* / We've got it — the founder will confirm shortly.

**M25 — roster churn.** Students joining or leaving a coach's regular class are
invisible to them until they notice a different face. Batch this into M10's
day-ahead message (*"1 new student in Improvers"*) rather than sending a message
per booking — per-booking would be unbearable noise.

#### Not proposed: payout summaries

A monthly *"you taught 34 sessions"* message is the obvious coach ask, but the
schema has **no pay rate anywhere** (`coaches` has bio, base location, levels,
DBS, credentials — no money). A session count alone is available today; anything
with ₹ in it needs a pay model that doesn't exist. Founder decision, not a gap.

---

### 9.4 Founder — the missing messages

The founder's WhatsApp is deliberately quiet, and that's right. Everything below
should be **feed + digest** by default, with only M14 earning a push.

#### M14 · At-risk families (the one worth pushing)

Nothing in the system watches for a family drifting away. Two signals, both
computable from existing tables:

- a player with **2 consecutive `no_show`s**
- a client with an **active subscription and zero bookings in 14 days**

> *3 families worth a call*
> Aarav S. — 2 no-shows in a row. Diya M. — active plan, nothing booked in 18
> days. Ishaan K. — plan renews Friday, hasn't attended since 2 Jul.
> `[ Open dashboard ]`

Weekly, WhatsApp. This is the difference between a save and a cancellation, and
it's the only category of message where the founder's *attention* is worth more
than the ₹ at stake.

#### M15–M18 · Business intelligence the digest doesn't carry

**M15 — capacity & utilisation.** `classes.capacity` and booking counts are
right there. Nothing surfaces the two decisions that actually run an academy:

> *This week's classes*
> Improvers (Sat 6:30) — full, 4 waitlisted → worth a second batch.
> Beginners (Wed 4:00) — 3/8 for three weeks → worth a look.

Sustained waitlists are a demand signal; a class running at 3/8 is a coach being
paid to teach three people.

**M16 — money in the digest.** `sweepFounderDigest` counts `ops_payment` **events**
and never totals them, so the daily line says *"3 payments"* and never *"₹13,500"*.
The amounts are on `invoices` and `orders`. One extra clause:

> Today at the academy (2026-07-29): 12 bookings · **₹13,500 collected** · 2
> cancellations · 1 new client

Also fold escalations into the same line — a day with three coach no-shows
currently shows nothing about them (**G13**).

**M17 — trial conversion.** Once M2–M4 exist, the funnel needs a scoreboard:
trials granted, used, converted, lapsed. Without it there's no way to know
whether the trial nudges work.

**M18 — weekly rollup**, Sunday evening: revenue, new members, cancellations,
attendance rate, trial conversion, coach reliability. The daily digest answers
*was today OK*; nothing answers *is the month OK*.

#### Smaller founder items

- **Coach reliability.** `handle_coach_dropout` fires and is never aggregated. A
  coach who dropped 4 sessions this month should surface in M18.
- **Safeguarding.** `coaches.dbs_checked` is stored and never checked at
  assignment time. A `dbs_checked = false` coach being assigned to a school or
  a junior session deserves at minimum a feed row.
- **Assessment compliance.** M13 chases coaches; the founder should see the
  academy-wide backlog in M18 (it's coaching quality, measurable).
- **M22 — invites.** `client_invites` and `coach_invites` store a phone number
  and nothing ever messages it, so every invite has to be delivered by hand.
  Since the phone is known, the invite itself can be the WhatsApp:
  > Hi Priya — Sharwin TTA has invited you to join. Tap to set up your family
  > and book your first session. `[ Accept invite ]`

---

### 9.5 How each new type should be classified

Slots into the §2 rule sets. `T` = transactional (ignores prefs), `D` =
deferrable (held to 08:00 IST), `Pref` = user-mutable, `Tmpl` = needs a Twilio
template (business-initiated, will often land outside the 24h window).

| Type | Audience | T | D | Pref | Tmpl | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `attendance_missed` | client | ✅ | ❌ | ❌ | ✅ | Safety — never mutable, never held. |
| `trial_available` | client | ❌ | ✅ | ❌ | ✅ | CTA → booking. |
| `trial_reminder` | client | ❌ | ✅ | ✅ | ✅ | Marketing — must be mutable. Cap at 2 sends. |
| `trial_followup` | client | ❌ | ✅ | ✅ | ✅ | Suppress if subscribed at send time. |
| `payment_received` | client | ✅ | ✅ | ❌ | ✅ | Receipt — transactional, but 2am is rude. |
| `renewal_upcoming` | client | ❌ | ✅ | ✅ | ✅ | Toggle already exists (G6). |
| `membership_changed` | client | ✅ | ✅ | ❌ | ❌ | Rare; free-form is fine. |
| `progress_updated` | client | ❌ | ✅ | ✅ | ✅ | Throttle 1/player/week. |
| `progress_monthly` | client | ❌ | ✅ | ✅ | ✅ | Monthly, per player. |
| `waitlist_joined` | client | ❌ | ✅ | ✅ | ❌ | Shares the waitlist toggle. |
| `minutes_expiring` | client | ❌ | ✅ | ❌ | ✅ | Money — don't let people mute it. |
| `reminder_day_before` | client | ❌ | ❌ | ✅ | ✅ | Reuse the `reminder_upcoming` toggle. |
| `welcome_first_session` | client | ❌ | ✅ | ❌ | ✅ | Once per household. |
| `invite_sent` | client/coach | ✅ | ✅ | ❌ | ✅ | Recipient has no account yet — template mandatory. |
| `player_birthday` | client | ❌ | ✅ | ✅ | ❌ | |
| `coach_day_ahead` | coach | ❌ | ❌ | ❌ | ✅ | 07:30 IST; skip empty days. |
| `cover_offer` | coach | ❌ | ❌ | ❌ | ✅ | Quick-reply buttons; first tap wins. |
| `coach_assessments_due` | coach | ❌ | ✅ | ❌ | ✅ | Weekly, only when non-zero. |
| `time_off_received` | coach | ✅ | ❌ | ❌ | ❌ | One-line ack. |
| `ops_at_risk` | founder | ❌ | ✅ | ❌ | ✅ | Weekly; the only pushed founder addition. |
| `ops_capacity` | founder | — | — | — | — | `FEED_ONLY` + weekly rollup. |
| `ops_trial_funnel` | founder | — | — | — | — | `FEED_ONLY` + weekly rollup. |
| `ops_weekly_digest` | founder | ❌ | ✅ | ❌ | ✅ | Sunday evening. |

Three cross-cutting consequences:

1. **`PREF_TYPES` has to grow.** G9 already notes members can mute only 5 of ~30
   types. Adding progress reports, trial nudges and birthdays *without* toggles
   would turn a transactional system into a marketing one people can't escape.
   Group them in the UI — *Reminders · Progress updates · Offers & news* — rather
   than listing 30 switches.
2. **Roughly a dozen new templates.** Most of these fire outside the 24h service
   window (a lapsed member, an unclaimed trial, an invitee with no account), so
   without an approved template they degrade to the generic
   `TWILIO_WA_TEMPLATE_SID` — which itself still has to be built by hand (§7).
   Provision cost is the real constraint on this list, so ship M1, M12 and M8
   first: highest value per template.
3. **Volume budget.** Fully built, a subscribed family with two players could
   receive a booking confirmation, a day-before nudge, a 3-hour reminder, an
   arrival ping, a progress note and a receipt in one week. Consolidate on the
   session boundary — **one** post-session message per player (attendance +
   progress together), not two.

---

## 10. Briefings — the morning-first redesign

§9 lists messages that don't exist. This section is about a message that *does*
exist and doesn't earn its place: the 21:00 founder digest. Fixing it turns out
to require rethinking *when* the academy talks to people, not just what it says
— which is why it gets its own section.

This expands **M10**, **M16**, **M18** and **M21** into a concrete design. Where
this section and those entries disagree, this section wins.

### 10.1 The digest as it stands

Yes — it is literally that string. These are verbatim bodies from `notifications`
in production:

| IST date | What the founder actually received |
| --- | --- |
| 25 Jul | `2 membership changes · 9 coach changes` |
| 26 Jul | `1 attendance update · 2 new clients · 1 new player · 1 WhatsApp link · 4 coach changes` |
| 28 Jul | `1 booking` |
| 29 Jul | `3 bookings · 1 attendance update · 3 membership changes · 5 new clients · 4 new players · 2 WhatsApp links · 2 coach changes` |

It has sent every day since 24 Jul 2026. The mechanism works. The message
doesn't, for four reasons:

**It counts rows, not events.** `summariseOps()` groups
`notifications.type` and pluralises the label. That's a count of *database
writes*, which is not a question anyone has. Nobody wakes up wanting to know
that eleven rows were inserted.

**It collapses opposites.** "2 membership changes" is the same string whether
two families joined on ₹4,500/month or two families quit. Those are the best and
worst things that can happen in this business, rendered identically.
`ops_membership` covers started / recovered / cancelled / paused — four
different futures, one word.

**No nouns, so no action.** No names, no times, no amounts, no venues. Every
line therefore requires opening `/admin` to mean anything — which defeats the
purpose of sending a message at all. "1 booking" is strictly less useful than
silence, because it costs attention and returns nothing.

**It omits the only urgent thing.** The digest counts `FEED_ONLY` types only, so
escalations are invisible (**G13**). On 29 Jul the founder's feed held:

```
ops_coach_not_arrived   8   ← omitted from the digest
ops_coach_unconfirmed   7   ← omitted from the digest
signup_request          2   ← omitted from the digest
ops_new_client          5   ✓ reported
ops_player_added        4   ✓ reported
ops_booking             3   ✓ reported
ops_membership          3   ✓ reported
ops_coach_change        2   ✓ reported
ops_wa_linked           2   ✓ reported
ops_attendance          1   ✓ reported
```

Fifteen coach-reliability incidents — the largest and most urgent category of the
day — were left out, while "2 WhatsApp links" made the cut. The digest reports
the routine and hides the exceptions, which is exactly backwards.

### 10.2 The newline constraint is self-imposed

The code comments justify the single line as a platform limit: *"WhatsApp
template variables reject newlines."* That's true, and it's the wrong conclusion.
The restriction is on **variable values**, not on template bodies. A template
body may contain as many fixed line breaks as you like.

The digest is one line because of how the template was written
(`scripts/whatsapp/provision-templates.mjs:277`):

```js
body: "Today at the academy ({{1}}): {{2}}"
```

Everything was packed into a single `{{2}}`, so the whole report inherited the
one-line rule that applies to a variable. Split the skeleton instead and the
constraint disappears:

```js
body: "🏓 Today at the academy — {{1}}\n\nClasses: {{2}}\nMoney: {{3}}\nNeeds you: {{4}}"
```

Each variable is still a single line; the message is now four. Three routes to a
rich briefing, in order of preference:

1. **Free-form inside the 24h window** — arbitrary newlines, no template, no
   approval, no variable cap. A founder with 44 bot tools is nearly always
   inside this window. This is the good version.
2. **Fixed-slot template outside it** — a skeleton with ~6 variables, one line
   each, list truncated to N items with "…and 3 more". Always deliverable.
3. **CTA escape hatch** — a short template plus `[ Open today ]`. Guaranteed to
   work and never truncates, but costs a tap and only works if the app is up.

Build (1) and (2); keep (3) as the fallback for very long days.

### 10.3 The reframe: brief in the morning, report at night

The deeper problem is timing. **A message is worth sending only while the
recipient can still change the outcome.** 21:00 is after everything has already
happened — a founder reading "1 booking" at 21:00 can do nothing with it. 07:00
is before everything, when every fact is still actionable.

So the academy should lead with a **morning briefing** and demote the evening
digest to **exceptions only**:

| | Morning (07:00 IST) | Evening (21:00 IST) |
| --- | --- | --- |
| Purpose | a plan | a reckoning |
| Content | what's scheduled, what's missing | what broke, what came in |
| Founder | classes, gaps, money due, trials | exceptions, money banked, no-shows |
| Coach | today's sessions + roster + backlog | — (their after-class message covers it) |
| Client | today's sessions for the household | — |
| Send when | there is anything on today | **only** if there's an exception or money |

### 10.4 Founder morning briefing — `founder_morning_brief`

07:00 IST daily. Skip entirely on a day with no sessions and no pending items.

> 🏓 *Today — Sat 12 Jul*
> 4 classes · 27 students · first at 4:00 pm
> ⚠️ Improvers 5:30 has **no coach** · 2 signups waiting on you
> 4:00 Beginners · La Plazza · Augustine · 6/8
> 5:30 Improvers · La Plazza · **—** · 8/8
> 6:30 Advanced · La Plazza · Ravi · 5/8
> 8:00 Private · Aarav S. · Augustine · 21 MG Road
> ₹9,000 renews today · Diya M.'s free trial at 4:00
> `[ Open dashboard ]`

Composition rules, in order:

1. **Headline** — class count, student count, first start.
2. **Exceptions, if any** — unassigned sessions, coaches on approved time off,
   signup requests awaiting approval, `past_due` members with a session today.
   Omit the whole line when empty; never print "0 problems".
3. **The schedule** — time · class · venue · coach · booked/capacity. A missing
   coach renders as `—` so the gap is visually obvious.
4. **Money and moments** — renewals due today, and any **free trial** booked
   today (the highest-leverage hour in the funnel — see M4).

Everything here is already in `class_sessions`, `bookings`, `classes`, `venues`,
`subscriptions`, `class_credits` and `coach_time_off`. No new tables.

### 10.5 Coach morning briefing — `coach_day_ahead`

This is the one the coaches need most, and it can do more than inform.

> 🏓 *Your day — Sat 12 Jul*
> 3 sessions · first at 4:00 pm
> 4:00 Beginners · La Plazza · 6 students (1 new)
> 6:30 Improvers · La Plazza · 8 students
> 8:00 Private · Aarav S. · 21 MG Road
> 2 assessments still to write from this week
> `[ All confirmed ]` `[ Something's wrong ]`

Three things it fixes at once:

**Travel planning.** Today a coach learns about each session 60 minutes before
it starts. A coach moving between La Plazza, a school and a private address
cannot plan a day out of a sequence of one-hour warnings.

**The roster.** `coach_before_class` names the class and venue but no headcount
and no names (**M11**). Flagging *(1 new)* matters — first impressions are what
convert a trial into a subscription.

**The confirmation loop.** `[ All confirmed ]` stamps `coach_confirmed_at` on
every session that day. Because `sweepCoachConfirmNudge` and
`sweepFounderEscalations` **already skip** sessions with that stamp, one tap at
07:00 silently retires the whole T-30 nudge and T-10 escalation chain for the
day — using logic that already exists, with no new suppression rules.

That matters because the escalation chain is currently firing constantly: **350
`ops_coach_unconfirmed` and 137 `ops_coach_not_arrived` in about 18 days**, 15 of
them on 29 Jul alone. At that volume the founder has stopped reading them. A
morning confirmation is how you get the number down without going blind.

**The honest caveat:** a coach who taps `[ All confirmed ]` by reflex at 07:00
and then forgets is unmonitored until T-0. So:

- Keep the **arrival** chain fully intact — `coach_arrival_check` at T-0 and
  `ops_coach_not_arrived` at T+10 are untouched. Confirming intent at breakfast
  is not evidence of turning up.
- Demote T-60 from a question to a statement — *"Beginners in an hour · La
  Plazza · 6 students"* — for sessions already confirmed. Keep the buttons only
  for sessions that aren't.
- Never let confirmation flow backwards: tapping *arrived* may stamp
  *confirmed* (it already does, correctly), but confirming must never imply
  arrival.

Net effect: the safety net moves off "did you answer a message" and onto "did
you actually arrive", which is the signal that was always the real one.

### 10.6 Client household briefing — `household_day_ahead`

08:00 IST, only on days the household has a session, **one message per household
rather than one per booking**:

> 🏓 *Today at the academy*
> Aarav · Beginners Batch · 6:30 pm · La Plazza
> Diya · Improvers · 8:00 pm · La Plazza
> Coach Augustine for both. Reply here if either can't make it.

This supersedes **M21** (evening-before) with something simpler. A parent with
two children currently receives two separate `reminder_upcoming` messages three
hours before each session; this is one message, in the morning, when the day is
still being planned.

Recommendation: make this the primary reminder and **drop the T-3h
`reminder_upcoming`** for any session already listed in a household brief that
morning — keeping it only for same-day bookings made after 08:00. One message
per household per day, down from one per booking. It shares the existing
*Session reminders* toggle; do not add a second mutable type.

### 10.7 The evening digest, rebuilt

Keep it, but change what it's for: exceptions and outcomes, never counts.

> *Today at the academy — 29 Jul*
> ✅ 4 of 4 classes ran · 24 of 27 attended
> 💰 ₹13,500 in — Priya S. joined (Monthly Group), 2 renewals
> ⚠️ Augustine never marked arrival at Improvers 6:30
> ⚠️ No-shows: Aarav, Diya, Ishaan
> 👋 2 new clients · 1 free trial booked
> `[ Open dashboard ]`

Rules:

1. **Exceptions first.** Escalations belong in the digest (**G13**) — they are
   the reason to read it.
2. **Name people and money.** "Priya S. joined (Monthly Group)", not "1
   membership change". Amounts come from `invoices` and `orders`, which the
   digest has never totalled (**M16**).
3. **Split `ops_membership` by direction.** Joins and cancellations must never
   share a label.
4. **Omit zeros and routine.** WhatsApp links and player adds are feed material,
   not digest material.
5. **Send nothing on a clean, quiet day.** If there are no exceptions and no
   money, the feed already has it. Silence is a valid digest.

### 10.8 Implementation notes

**Quiet hours will break this if you're not careful.** The window is IST
`[21:30, 08:00)`, so a 07:00 briefing added to `DEFERRABLE` would be pushed to
08:00 and quietly lose an hour of lead time — the entire point of the message.
Both morning briefs must be **absent from `DEFERRABLE`**, like reminders and
escalations already are. The client household brief at 08:00 sits just outside
the window and is safe either way.

**Sweeps.** Three new sweeps alongside the existing seven, each guarded by a
once-per-(user, IST date) existence check exactly like `sweepFounderDigest`:
`sweepFounderMorning` (07:00), `sweepCoachMorning` (07:00),
`sweepHouseholdMorning` (08:00). Each must no-op when the day is empty.

**Buttons.** `[ All confirmed ]` needs a new id in `lib/whatsapp/interactive.ts`
resolving to *every* session for that coach on that IST date — note this is the
first coach button that is **not** session-scoped, so the existing
`OriginalRepliedMessageSid → session_id` resolution doesn't apply. Coach loose
word matching should accept `confirmed` / `all good` for it.

**Templates.** Three new multi-line skeletons (§10.2), plus rewriting
`founder_daily_digest` to split `{{2}}`. Rewriting an approved template means
re-approval, so treat the digest rewrite as a new template rather than an edit.

**Message volume.** For a founder the count is unchanged (one morning brief
replaces nothing, but the evening digest now often sends nothing). For a coach
with three sessions it drops from 3 confirm prompts + 3 nudges to 1 brief plus
informational T-60s. For a two-child household it drops from 2 reminders to 1
brief. The redesign adds information and removes messages, which is the only
direction worth moving in.

**Fix the delivery hole first.** Of three founder profiles, one
(`sharwinttacademy@gmail.com`) has no phone and no `wa_links` row and has
**failed all 6 digests**; another has no `wa_links` row and is reaching email
only. Richer briefings are worthless to an account that cannot receive them —
link a phone or drop the founder role before building any of this.

---

## 11. Why each message exists

§3–§5 say *what* goes out. This section says *why* — the job each message does,
who is expected to act on it, and what breaks if it's deleted. Written because
every future argument about this system ("should we add X?", "can we mute Y?")
is really an argument about the reasoning below, and that reasoning has until now
lived only in people's heads.

### 11.1 The test a message has to pass

**A notification is justified only when someone's behaviour should change, and
they wouldn't otherwise know to change it.**

Both halves matter. If nobody acts, it's a log entry — put it in the feed. If
they'd find out anyway at the moment they need to, it's redundant — a parent
opening the app tomorrow doesn't need a push tonight.

The cost side is easy to forget: **attention is the currency, and it inflates**.
The proof is already in this system's own data — 350 `ops_coach_unconfirmed`
escalations in about 18 days. Each was individually justified. Collectively they
trained the founder to ignore the category, which means the 351st — the one that
mattered — is now free to fail silently. Every message spends the credibility of
every other message sharing its channel.

So the three questions for any type, in order:

1. **Who acts?** Name the person and the action. If you can't, it's feed.
2. **What's the cost of them not knowing?** This sets urgency, and therefore
   whether it may be deferred or muted.
3. **What's the cost of being wrong?** This sets how aggressive the trigger and
   the inbound matching may be.

### 11.2 The nine jobs

Every existing message does one of nine jobs. The job — not the audience —
determines the delivery rules, which is why the same type (`session_cancelled`,
`coach_changed`) can legitimately go to different roles with different copy.

| Job | What it tells you | Types |
| --- | --- | --- |
| **Commitment** | you now owe someone your time | `booking_confirmed`, `coach_assigned`, `new_private_session`, `session_booked` |
| **Recall** | an obligation you already have is imminent | `reminder_upcoming`, `coach_before_class`, `coach_confirm_nudge_2`, `coach_arrival_check` |
| **Change** | a commitment still exists but has moved | `booking_rescheduled`, `session_moved`, `class_updated`, `coach_changed` |
| **Revocation** | a commitment is gone | `session_cancelled`, `private_series_ended`, `private_minutes_low` |
| **Scarcity** | act now or lose it to someone else | `waitlist_spot` |
| **Reassurance** | something you can't see is going fine | `coach_arrived`, `coach_late` |
| **Escalation** | someone else's failure now needs a human | `ops_coach_unconfirmed`, `ops_coach_not_arrived`, `session_unassigned`, `private_request_parked`, `session_issue`, `ops_payment_issue`, `ops_private_series_paused` |
| **Money** | an obligation involving payment | `payment_failed` |
| **Access** | your relationship to the system changed | `signup_request`, `signup_approved`, `role_changed`, `time_off_requested`, `time_off_decision` |

Everything else — the 11 `ops_*` feed types, `ops_daily_digest`, `announcement` —
does **no** job in this taxonomy. That's not a criticism; it's the definition of
why they're feed-only or broadcast rather than push (§11.6).

### 11.3 Client messages — the reasoning

The client is a **parent who is not present**. Almost every design decision below
follows from that one fact: the person paying cannot see the thing they're
paying for, and the person attending is a child who can't report on it.

#### Commitment and recall

**`booking_confirmed`** exists to close the loop on an action the parent just
took. Its real job is *proof*, not news — they know they booked. Without it, a
tap that appears to do nothing generates a WhatsApp to the founder asking "did
that work?", which is the most expensive possible way to answer the question.
Deferrable because a confirmation the next morning still proves the same thing.

**`reminder_upcoming`** is the only message preventing the most costly failure in
the system — a paid-for, capacity-consuming seat going empty. A no-show costs the
academy the seat, the coach's time, and (via the waitlist) another family's
chance to attend. T-3h was chosen as "late enough to be top-of-mind"; §10.6
argues that's wrong, because a parent needs to arrange transport before the
working day, not during it.

It is **not deferrable** — a 6am session's reminder must fire at 3am or it is
worthless. And it's the one message with the strongest case for a **mute
toggle**, because a family with a fixed weekly routine genuinely doesn't need it.

**`waitlist_spot`** is the only *scarcity* message, and the only one with a
deadline. Everything unusual about it follows from being a race: it must be
non-deferrable (a spot held overnight is a seat lost), it must have buttons (the
claim has to be one tap or the spot goes stale), and it must have an expiry
sweep re-offering to the next family. The 15-minute window is the compromise
between "give a parent time to check" and "fill the seat before the session".

#### Change and revocation

**`booking_rescheduled`**, **`session_moved`**, **`class_updated`** all answer
one question — *is the thing I planned around still true?* They exist because the
alternative failure is a family arriving at a venue at a time when nothing is
happening. That's not merely inconvenient; it's the single fastest way to lose
trust in a small academy.

`session_moved` and `class_updated` are **not deferrable**, which §8 flags as a
bug (**G7**), and the reasoning supports the complaint: a class edited at 23:00
pings every booked parent overnight to tell them about something happening in
three days. The urgency should key off *when the session is*, not when the edit
was made. A change to tomorrow's session is urgent at any hour; a change to next
month's is not.

**`session_cancelled`** is **transactional** — it ignores preferences entirely —
for a simple reason: suppressing it strands a child at a venue. This is the
clearest case in the system where the recipient's stated preference must be
overridden, because the harm of silence falls on someone who never expressed one.

The copy also carries a second, commercial job: *"your session allowance is
unaffected"* / *"your minutes have been returned"*. A cancellation is a moment of
felt loss, and the sentence that prevents a support message is the one confirming
they haven't been charged for nothing.

**`private_series_ended`** and **`private_minutes_low`** exist because a *silent*
stop is indistinguishable from a bug. A weekly slot that simply stops appearing
reads as broken software; the same event with an explanation reads as a lapsed
plan and prompts a renewal. `private_minutes_low` is throttled to once per three
days per series because the underlying condition re-evaluates continuously —
without the throttle a lapsed family would be messaged every time the booker ran.

#### Reassurance — the category unique to children's activities

**`coach_arrived`** and **`coach_late`** do no logistical work at all. Nobody has
to do anything. They exist to resolve an information asymmetry that barely occurs
in other businesses: a parent has left a child somewhere and cannot verify that
the responsible adult is present.

That makes these the highest trust-per-byte messages the academy sends, and it
explains two otherwise odd design choices:

- **Auto-detected arrivals are delayed two minutes** so a coach's *Undo* beats
  the outbound message. A false "your coach has arrived" is worse than no message
  — it's an assurance about a child's safety that turns out to be untrue, so the
  system deliberately trades timeliness for never being wrong.
- **They're sent per booking-holder**, not per class, because the reassurance is
  personal. A broadcast would read as marketing.

`coach_late` is the same job inverted: it converts an unexplained absence — the
condition under which a parent starts phoning — into a known, bounded wait.

#### Money and access

**`payment_failed`** is the system's only message that is *both* transactional
and deferrable, and that combination is precise rather than contradictory:

- **Transactional** (ignores prefs) because letting someone mute payment failures
  ends with a family silently losing access to sessions they believe they've paid
  for.
- **Deferrable** (held to 08:00 IST) because **nobody updates a card at 2am**.
  The action it requests can only be taken during waking hours, so firing
  overnight buys nothing and costs sleep.

That pair is the clearest illustration of the framework: *transactional* answers
"may this be suppressed?", *deferrable* answers "can they act on it right now?".
They're independent questions and this type answers them differently.

**`signup_approved`** is transactional because it's the gate to everything else —
a muted approval leaves someone permanently stuck on a pending screen with no
way to discover they've been let in. It's deferrable for the same reason as
payment: nobody onboards a family at 2am.

**`announcement`** is the only message with no trigger, no schedule and no
preference. It exists because an academy occasionally has to say something no
data model anticipates — a venue flooding, a holiday, an equipment change. The
absence of a toggle is deliberate: a broadcast a member has muted is worse than
no broadcast, because the founder believes it landed.

### 11.4 Coach messages — the reasoning

The governing fact for coaches is different: **the coach is a single point of
failure with no redundancy.** Most businesses degrade gracefully when a worker
doesn't show — a queue lengthens, a task slips. An academy does not. If the coach
isn't at the venue, twelve children and their parents are standing in a hall with
nothing happening, and the failure is fully public.

Every coach message is therefore built to answer one question progressively
earlier: *will this session actually happen?*

#### Why the class-day sequence has four steps

The T-60 → T-30 → T-0 → T+10 ladder looks like nagging. It's actually a
**confidence-building schedule with a widening blast radius**, where each step
buys the founder more time to fix the problem than the last:

| Step | What it establishes | Time left to find cover |
| --- | --- | --- |
| T-60 `coach_before_class` | intent | 60 min — a substitute can still travel |
| T-30 `coach_confirm_nudge_2` | intent, second attempt | 30 min — a nearby substitute only |
| T-10 `ops_coach_unconfirmed` | **the founder now owns it** | 10 min — phone calls |
| T-0 `coach_arrival_check` | presence, not just intent | none — damage limitation |
| T+10 `ops_coach_not_arrived` | confirmed failure | none — apologise and refund |

The steps exist because *intent and presence are different facts*. A coach can
sincerely confirm at T-60 and still be stuck in Bangalore traffic at T-0, which
is why confirming doesn't satisfy the arrival check. The asymmetry runs one way
only, and correctly: tapping **arrived** stamps *confirmed* (presence proves
intent), but confirming never implies arrival.

The escalations are addressed to the founder rather than the coach because by
T-10 the coach has already failed to respond twice; a third message to the same
silent phone has no expected value. The failure is handed to the only person with
authority to reassign, cancel or apologise.

**Why the copy warns the coach about escalation.** `coach_confirm_nudge_2` says
*"the founder gets alerted in 20 minutes if we haven't heard"*. This is
deliberate: it converts a surveillance system into a fair one. The coach is told
the consequence before it happens, which both prompts a reply and removes any
sense of being reported on behind their back.

**`coach_after_class`** does three jobs in one message, which is why it's the
longest: it closes the session (attendance), collects the data the academy's
value depends on (assessment notes), and — via *"Up next today: Improvers at 7:30
pm"* — does the only forward-looking work in the entire coach flow. That last
clause exists because there was no day-ahead message; §10.5 argues it should be
promoted to a proper morning briefing rather than smuggled into a footer.

Attendance is collected *here*, from the coach, rather than inferred, because
attendance drives no-show tracking, credit consumption and the founder's
retention picture. Asking at the moment the coach is still in the hall is the
only point where the answer is both known and cheap.

#### Schedule changes

The `coach_changed` family (four variants) and the coach copies of
`session_cancelled` / `session_moved` all exist to protect against one specific
failure: **a coach travelling to a session that isn't theirs any more**, or
missing one that just became theirs. Because coaches are peripatetic and paid per
session, an unnotified reassignment costs them real money and a wasted journey.

That's also why they're **deferrable** — a reassignment three weeks out doesn't
justify a 2am message — and why founder-side coach changes only notify for
sessions **within the next 7 days**: beyond that horizon the coach hasn't planned
around it yet, so there's no plan to correct.

**`role_changed`** exists because promotion to coach silently changes what the
app and the bot will do for you. Without it, a newly promoted coach has no way to
discover that messaging the bot now returns rosters and availability.

**`time_off_decision`** closes a loop the coach opened. Its absence would leave
someone unable to plan their own life, which is the whole point of requesting
time off. That it's **deferrable** reflects that a decision is rarely so urgent
it can't wait for morning.

### 11.5 Founder messages — the reasoning

The founder's position is unusual: **RLS gives them omniscience and the day gives
them no time.** They can see everything, so the design problem isn't access —
it's rationing attention. That's the entire justification for the split.

#### Why `FEED_ONLY` exists at all

The 11 `ops_*` types are facts the founder may want *later* — when reconciling
payments, investigating a complaint, or reviewing a week. They're written to the
database and rendered on `/admin`, and deliberately never pushed.

The reasoning is a volume argument. A functioning academy generates dozens of
these a day (271 `ops_booking` rows in about 18 days). Pushing them would make
WhatsApp unreadable within a week and would, by §11.1, destroy the channel for
the escalations that actually need it. **Feed-only is not a lesser tier — it's
what protects the tier above it.**

The anti-flood rules follow the same logic, each removing a specific known
flood: series bookings notify once rather than weekly; sweep-marked attendance
(no `auth.uid()`) stays silent because nobody did anything; coach changes only
surface inside 7 days; the auto-created signup player is skipped because the
founder just caused it.

#### Why escalations *are* pushed

Escalations share one property that no feed item has: **they expire**. A coach
who hasn't confirmed with 10 minutes to go is only actionable for 10 minutes.
After the session starts, knowing costs the same and buys nothing. Feed items,
by contrast, are equally useful whenever they're read.

That's the real dividing line — not importance, but **whether the information
has a shelf life**. `session_unassigned`, `private_request_parked` and
`session_issue` all qualify: each names a session that will fail unless a human
intervenes before a fixed time.

**`signup_request`** is the only founder message that is transactional *and*
non-deferrable, which is a deliberate exception. An applicant is sitting on a
pending screen right now, unable to do anything until the founder taps. Holding
it to 08:00 would mean an evening applicant waits overnight looking at a system
that appears broken. The founder's sleep is traded for the applicant's first
impression — the correct trade for a business that depends on conversion.

**`ops_payment_issue`** and **`ops_private_series_paused`** are named like feed
items but pushed like escalations (**G2**). Judged by the shelf-life test they're
genuinely escalations — dunning has a grace window, and a paused private series
blocks a paying member — so the fix is to rename them, not to silence them.

#### Why the digest exists, and why it fails

The digest is the compromise between "the feed is invisible unless you open the
app" and "pushing the feed destroys the channel". Sound reasoning; the execution
inverts it. By counting only `FEED_ONLY` types it summarises exactly the material
that was defined as *not worth pushing*, while omitting the escalations that
were. §10 covers the rebuild.

### 11.6 Why the delivery rules are drawn where they are

The three lists in §2 look arbitrary until you see the question each answers.

**`TRANSACTIONAL` — "would suppressing this cause harm the member didn't
knowingly accept?"** Muting a reminder is a choice with a known consequence.
Muting a cancellation strands a child; muting a payment failure ends a
membership by surprise; muting an approval traps someone outside the app. The
four members of the set are precisely the cases where the harm lands on someone
who didn't choose it, or is out of proportion to the annoyance avoided.

**`DEFERRABLE` — "could they act on this at 3am?"** Not "is it important" —
`payment_failed` is in both lists. Reminders, waitlist offers, arrivals and
escalations are absent because their value *is* their timing: a waitlist offer
held to morning is a seat lost, an arrival ping at 08:00 is about a session that
ended twelve hours ago.

**`FEED_ONLY` — "does this information expire?"** (§11.5.) The eleven types are
all equally useful read now or next Tuesday, so they wait.

**`PREF_TYPES` — "is the recipient the best judge of whether they need this?"**
The five toggles are all cases where a settled family genuinely knows better than
the system: they know their Saturday routine, they don't want waitlist offers,
they don't care which coach. Everything unmutable either carries harm
(transactional) or is rare enough that a toggle is theatre. §8 is right that the
line is drawn too tightly (**G9**) — and §9.5 warns that the proposed progress and
trial messages *must* be mutable, because a marketing message people can't
escape is how you lose a WhatsApp sender number.

### 11.7 Why inbound matching is deliberately asymmetric

Coaches get loose one-word matching (`coming`, `arrived`, `late`). Clients and
the founder must tap a button or quote an exact title against the replied-to
message SID. That looks like favouritism; it's **blast radius**.

| Role | Worst case of a false match | Recoverable? |
| --- | --- | --- |
| Coach | a session wrongly marked confirmed | Yes — the arrival chain still runs at T-0 and T+10, so the error surfaces within the hour |
| Client | a booking cancelled, or a waitlist spot passed | **No** — the seat is released to another family immediately, and the parent isn't told the message was interpreted as an instruction |
| Founder | a membership approved or denied by accident | **No** — grants or denies access to a stranger |

So looseness is calibrated to how bad it is to be wrong, and the safety net
behind the coach path is what pays for the convenience. This is also why the
"can't make it" flow is a **two-step confirm** with a 30-minute arm: a coach
dropout triggers reassignment and parent-facing churn, so it's the one coach
action expensive enough to demand a second word.

The same reasoning explains matching the *whole message* rather than substrings —
*"running late for the airport"* must not mark a session late — and why the
absent-marking prompt expires after 2 hours: a stray "2 4" the next morning
shouldn't retroactively mark two children absent.

### 11.8 Messages that don't pass their own test

Applying §11.1 honestly, three things in the current system fail:

**The digest's routine half.** "2 WhatsApp links · 4 new players" identifies
nobody who should do anything. By its own logic it belongs in the feed it was
summarising. (§10.7.)

**Escalation volume.** 350 `ops_coach_unconfirmed` in 18 days means the type has
stopped satisfying "they wouldn't otherwise know" — the founder now expects them
and has learned to skip them. The message is fine; the *rate* has broken it, and
the fix is upstream (morning confirmation, §10.5), not louder copy.

**`ops_daily_digest` on a one-event day.** 28 Jul's entire digest was `1 booking`
— a push notification whose content was already in the feed and required nothing
of anyone. The "send nothing on a quiet day" rule exists but is set at *zero*
events; it should be set at *zero interesting* events.

And the mirror image — the largest failures of the framework are the messages
that would pass it easily and don't exist. A no-show tells a parent their child
is missing and nobody sends it (**M1**); an unassigned session tells the coaches
who could cover it and only the founder hears (**M12**). §9 is the backlog those
create.

---

## 12. What information each message actually carries

§11 explains why a message is sent. This section audits what it *contains* —
because a message can pass every test in §11 and still arrive empty. All payload
data below is read from production `notifications` rows, not inferred from code.

### 12.1 The three payloads, and why `data` is the one that matters

Every row carries three separately-consumed pieces:

| Field | Consumed by | Notes |
| --- | --- | --- |
| `title` + `body` | free-form WhatsApp render, email, in-app feed | prose; can say anything |
| `data` jsonb | **template variables**, deep links, button→session resolution | structured; the only machine-readable layer |
| `twilio_sid` (written into `data` on send) | inbound button taps | maps a reply back to a session |

The trap: **`title`/`body` and `data` are populated independently**, and the
template path reads *only* `data`. So a message whose body reads perfectly can
render as a generic template, because the fact in the prose was never written to
the payload. Several already do.

### 12.2 What each type actually carries

Distinct `data` keys observed across all production rows (`url` omitted — nearly
everything has it):

| Type | Payload keys in production | Verdict |
| --- | --- | --- |
| `coach_before_class` | `class_title`, `time_str`, `location_str`, `first_name`, `kind`, `session_id` | rich |
| `coach_after_class` | `class_title`, `next_sentence`, `first_name`, `kind`, `session_id` | rich |
| `coach_arrived` | `coach_name`, `location_str`, `time_str`, `session_id` | rich, but see 12.3 |
| `reminder_upcoming` | `class_title`, `time_str`, `booking_id`, `session_id` | rich |
| `signup_request` | `applicant_name`, `applicant_email`, `applicant_phone`, `client_id` | rich |
| `ops_daily_digest` | `date`, `summary` | complete for what it is |
| `coach_assigned` | `coach_id`, `session_id` | no time, no class |
| `booking_confirmed` | `booking_id`, `session_id` | no time, no class |
| `ops_booking`, `ops_cancellation`, `ops_attendance` | `booking_id`, `session_id`, `client_id` | ids only |
| `ops_payment`, `ops_membership`, `ops_new_client`, `ops_credit_used`, `ops_wa_linked` | `client_id` | **id only** |
| `coach_changed` | `session_id` | no coach, no class, no time |
| `session_cancelled`, `session_moved`, `session_unassigned` | `session_id` | id only |
| `coach_late` | `session_id` | **missing `coach_name`** — see 12.3 |
| `class_updated`, `session_booked` | *(nothing but `url`)* | not even a session id |
| `payment_failed` | *(empty payload)* | **nothing at all** |
| `announcement` | *(empty payload)* | acceptable — it's free prose |

### 12.3 Template variables vs. payload — the audit

Each template asks `interactiveContentFor()` for specific keys and silently
substitutes a generic string when they're absent. Cross-referencing what each
template wants against what production rows carry:

| Template | Wants | Reality |
| --- | --- | --- |
| `coach_coming_check` | class, time, venue | ✅ complete |
| `coach_class_complete` | class, next-sentence, url | ✅ complete |
| `coach_private_session` | name, body, session id | ✅ complete |
| `client_session_reminder` | name, class, time | ✅ complete |
| `client_booking_confirmed` | name, body | ✅ complete — reads `row.body`, not `data` |
| `client_signup_approved` | name | ✅ complete |
| `founder_signup_request` | name, email, phone | ✅ complete |
| `founder_daily_digest` | date, summary | ✅ complete (but see §10.1) |
| `client_coach_arrived` | name, **coach**, venue, time | ⚠️ `coach_name` on **13 of 51 rows** — the other 38 failed the `d.coach_name` gate and fell back to free-form |
| `client_payment_issue` | name, **plan** | ❌ payload is empty → **always** "your membership" (**G3**) |
| `client_coach_late` | name, **coach**, time | ❌ `coach_name` on **0 of 5 rows** → the template has *never once been used* |
| `client_waitlist_spot` | name, class, minutes | ❌ type has never fired at all (§12.5) |
| `coach_arrival_check` | name, class, venue | ❌ type has never fired at all (§12.5) |

Two findings here that §8 didn't have:

**`client_coach_late` is provisioned and dead.** `coach_mark_arrival` writes
`coach_name` when marking arrival but not when marking late, so the gate
`d.coach_name` never passes. Every "running late" message a parent has ever
received took the free-form path. The same asymmetry degrades
`client_coach_arrived` for three quarters of its sends.

**`payment_failed` carries an empty payload** — not `{url}` as §8 assumed, but
genuinely nothing. So both template variables fall back, and the CTA URL is the
static one baked into the template.

### 12.4 Information the recipient needs and is never offered

Reading the payload table against §11's "who acts?" test:

**`coach_changed` tells a parent their coach changed and cannot name the new
coach.** It carries `session_id` alone, so the message is *"Your session has a
new coach — say hello at the table"* with no name, no class and no time. For the
message whose entire job is reassurance about who will be supervising a child,
that is the wrong field to be missing.

**`class_updated` carries no session id.** The message says *"check your
schedule"* because the payload literally cannot support anything more specific —
the recipient can't even be deep-linked to the class that changed.

**`ops_payment` carries no amount.** This is why the digest counts payments and
can never total them (**M16**): the money isn't in the payload. Fixing the
digest means either adding an `amount_pence` key at the insert site or joining
`invoices`/`orders` at digest time.

**`ops_membership` carries no direction.** Started, recovered, cancelled and
paused all produce the same key set (`client_id`), with the difference only in
the prose title. §10.7 asks the rebuilt digest to stop conflating joins and
cancellations — that needs a `change` key added at the insert site, not just a
smarter query.

**Nothing coach-facing carries a roster.** `coach_before_class` is the richest
payload in the system and still has no headcount and no names (**M11**); the
roster is fetched at *reply* time, after the class.

### 12.5 Messages that offer no information because they never fire

The strongest finding in this audit. Three types have **zero rows in
production, ever**, despite being fully implemented, documented in §4.1, and (for
two of them) having approved Twilio templates provisioned:

| Type | Rows ever | Should fire |
| --- | --- | --- |
| `coach_confirm_nudge_2` | **0** | T-30, coach hasn't confirmed |
| `coach_arrival_check` | **0** | T-0, coach hasn't marked arrival |
| `waitlist_spot` | **0** | a confirmed seat frees up |

This is not a case of the conditions never arising. `ops_coach_unconfirmed`
(T-10, *same* filters, narrower window) has fired **350 times**, and
`ops_coach_not_arrived` **268 times**. Every one of those sessions passed through
the T-30 and T-0 windows in exactly the state those sweeps look for.

So the coach class-day ladder documented in §4.1 as five rungs is, in
production, **two**:

```
T-60  coach_before_class      ✅ 186 sent
T-30  coach_confirm_nudge_2   ❌ never fires
T-10  ops_coach_unconfirmed   ✅ 350 sent   → founder
T-0   coach_arrival_check     ❌ never fires
T+10  ops_coach_not_arrived   ✅ 268 sent   → founder
```

The consequences are exactly what §11.4 predicts when you remove the middle of a
ladder:

- A coach gets **one** chance to confirm, then the founder is escalated. The
  second chance the design depends on doesn't exist — which is a large part of
  why the founder has 350 escalations to ignore.
- **The founder is escalated 268 times for coaches not marking arrival, when the
  coach was never asked to mark arrival.** The T+10 alert presupposes a T-0
  question that is never asked. Coaches are being reported for failing to answer
  a message they never received.
- `waitlist_spot` never firing means the entire waitlist offer path — its
  template, its expiry sweep, its `Claim spot`/`Pass` buttons, and gap **G4** —
  is untested in production.

All seven sweeps *are* invoked (`index.ts:192-198`), and the columns they filter
on exist, so the two coach sweeps are either throwing inside `safeSweep` — which
logs to console and deliberately swallows, so a permanently broken sweep looks
identical to a quiet one — or matching nothing for a reason the filters don't
make obvious. `waitlist_spot` may be innocent: if no class has ever filled and
then freed a seat, zero is correct.

**This is a live bug, not a documentation gap.** It should be diagnosed from the
edge function logs before any of §9 or §10 is built, because the morning
briefing in §10.5 is designed to absorb a confirmation ladder that currently
isn't running.

### 12.6 Two rules worth adopting

**Write every fact in the prose into the payload too.** Most degraded templates
in §12.3 exist because a fact reached `body` and not `data`. The insert sites are
the only place that knows both.

**A template variable with no backing key is a silent failure.** Nothing warns
when `d.plan_name` is absent — the member just gets "your membership" forever.
Any new template (§9.5 proposes about a dozen) should ship with a test asserting
the producing RPC writes every key the template reads. `tests/db/` already
asserts `notifications` rows, so this is a natural extension, and it's the seam
where G3, G4 and both findings in §12.3 all live.

---

## 13. Testing

- `npm run test:db` (`tests/db/`) asserts `notifications` rows produced by the
  RPCs — `arrival.test.ts`, `booking.test.ts`, `cancellation.test.ts`,
  `coach-session.test.ts` are the relevant ones.
- `npm run e2e:flows` (`e2e/flows/coach-arrival.spec.ts`, `coach-day.spec.ts`)
  drives the coach screens that produce the same rows.
- Neither layer exercises the notify worker, the template mapping, or Twilio.
  Gaps G1–G4 are all in that untested seam.
