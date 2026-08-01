# Notifications — what the academy sends

The as-built answer to "what goes out, to whom, when, and why". Written
2026-07-31 against production. `whatsapp-messaging.md` is the companion: it
covers the *transport* (Twilio templates, the inbound bot, opt-outs); this
covers the *messages*.

Everything is one table. `notifications` rows are inserted by Postgres triggers
and RPCs, then claimed once a minute by the `notify` edge function, which
decides the channel: **web push → WhatsApp → email**, first one that works.

> `notify` has **no autodeploy**. Editing `supabase/functions/notify/index.ts`
> and pushing changes nothing in production until someone runs
> `supabase functions deploy notify`.

---

## 1. The four rules that shape everything

| Rule | Where | Effect |
| --- | --- | --- |
| **Feed-only** | `FEED_ONLY` | 13 `ops_*` types render on `/admin` and are **never** delivered. The founder's phone gets escalations + one digest, not a running commentary. |
| **Quiet hours** | `DEFERRABLE` | Non-urgent types coming due in IST 21:30–08:00 are pushed to 08:00. Reminders, arrivals and escalations are deliberately excluded so they still fire. |
| **Daily cap** | `DAILY_SEND_CAP = 3` | Nobody gets more than 3 non-essential messages per IST day; overflow is **held to the next morning**, not dropped (and abandoned after 3 days). |
| **Cap exemptions** | `CAP_EXEMPT` | The cap must not muzzle a coach teaching four classes or a parent hearing their coach is late. Time-critical and session-operational types are exempt, so the cap bites the informational tail. |

Two more cross-cutting switches: `TRANSACTIONAL` types ignore user preferences
entirely (payment failed, cancellation, signup, `player_absent`), and
`profiles.wa_muted` (STOP/START) silences WhatsApp for one person.

Members see **three** grouped toggles — Reminders · Progress · News & offers —
not a switch per type.

---

## 2. What each role actually receives

### Coaches

| Message | When | Buttons |
| --- | --- | --- |
| `coach_before_class` | T−60min | Yes, I'm coming / Can't make it |
| `coach_confirm_nudge_2` | T−30min, only if still silent | — (plain text) |
| `coach_arrival_check` | At start, only if arrival unmarked | I've arrived / Running late |
| `coach_after_class` | After the session | All present / Some absent |
| `new_private_session` | On assignment | View session |
| `cover_offer` | When a session loses its coach | First tap wins |
| `session_cancelled`, `coach_changed`, `session_moved` | On the change | — |

### Parents / clients

| Message | When | Buttons |
| --- | --- | --- |
| `reminder_upcoming` | T−3h, **one** consolidated reminder | I'll be there / Can't make it |
| `coach_arrived` / `coach_late` | When the coach marks it | — |
| `session_outcome` | After the session, carries the coach's note | — |
| `player_absent` | Child marked absent — **never** deferred or muted | — |
| `waitlist_spot` | A place opens | Claim spot / Pass |
| `booking_confirmed`, `private_session_booked`, `coach_assigned` | On booking | View schedule |
| `signup_approved` | Founder approves | Open the app |
| `payment_failed` | Card declines | Fix payment |

### Founders

Escalations only — `ops_coach_unconfirmed` (T−10, coach fully silent) and
`ops_coach_not_arrived` (start+10) — plus `signup_request` (Approve/Deny) and
one `ops_daily_digest` at 21:00 IST. Everything else is the in-app feed.

There is no separate "admin" role: `profiles.role` is `founder`, `coach` or
`client`, and admin *is* founder.

---

## 2a. The founder digest — one, at 21:00

`sweepFounderDigest`:

| | |
| --- | --- |
| How many | **One** evening digest. (There are also two 07:00 IST *briefings* — see below.) |
| When | 21:00 IST or later, once per IST calendar day |
| Who gets it | **Founders only.** `role = 'founder'`, fanned out to all three. Coaches and clients receive no digest. |
| Source | `founder_day_report(p_date)` — per-session punctuality and roster facts (migrations `0056`, `0057`) |
| Wording | `summariseDay()` in `supabase/functions/notify/digest.ts` — pure, unit-tested |
| When it stays silent | Nothing was scheduled → nothing is sent. A day where everything ran cleanly **is** reported; that is the founder's "all good". |

Four labelled lines, each one WhatsApp template variable:

| Line | Answers |
| --- | --- |
| **Punctuality** | `7 of 15 sessions started on time` + who was ≥5 min late, named |
| **Rosters** | `0 of 2 rosters marked · 2 left blank` |
| **Arrivals marked by coach** | `Augustine 0/3 · Samir 0/2 · Nandhan 2/3 · Keerthana 3/4` — **every** coach, worst first |
| **Needs you** | Sessions with no coach, coaches who marked none, blank rosters |

The per-coach line is the academy's only per-coach adoption signal — arrival
marking is the one thing every coach is asked to do on every session. It
replaced a per-*session* list truncated at three names, which could name one
coach, hide the rest, and never answer "who is actually using this?".

### Two shape rules that are easy to break

- **A newline is legal in a template BODY and illegal in a template VARIABLE.**
  Twilio 63016s the send rather than stripping it. This is why the digest was a
  single run-on paragraph for its first three days: v1 and v2 of the template
  declare one variable, so all four sections had to be crammed inside it.
  `founder_daily_digest_v3` declares one variable per line and supplies the
  breaks itself. Everything `summariseDay()` returns must stay newline-free.
- **An unassigned session is not a coach failure.** `founder_day_report` used to
  coalesce a null coach to the literal name `Unassigned`, so a class nobody was
  rostered onto was reported as `Unassigned never marked arrival (…)`. Migration
  `0057` makes `coach_name` NULL instead, and the two are now separate lines.

### The morning briefings do exist

`founder_morning_brief` and `coach_day_ahead` both run at 07:00 IST
(`sweepFounderMorningBrief`, `sweepCoachDayAhead`) and both are deliberately
absent from `DEFERRABLE` — quiet hours run to 08:00, and deferring a 07:00
briefing destroys the lead time that is its entire point. `household_day_ahead`
remains a proposal.

---

## 3. What changed, and what it fixed

Reconstructed from the July 2026 rework (migrations `0041`–`0049`).

| Before | Now |
| --- | --- |
| **The arrival ladder never fired once.** Zero `coach_arrival_check` or `coach_confirm_nudge_2` rows had ever existed, while the founder was escalated 487× about a ladder that wasn't running. | Both fire. First real rows appeared 2026-07-30. |
| One T−60 prompt with three buttons including "I've arrived" — which trained coaches to tap it before leaving home. | Split into two one-question prompts: "coming?" at T−60, "reached?" at start. |
| `reminder_24h` **and** `reminder_2h`. | One `reminder_upcoming` at T−3h. |
| Privates booked from `/admin` queued **no reminder at all** — 11 reminders against 52 bookings, because only the client-initiated RPC queued them. | Every private queues one, whoever books it. |
| Email sent from `notify@resend.dev`, Resend's shared test domain, which **only delivers to the account owner**. A whole class of failures was this. | Sends from the verified `sharwinacademy.com` domain. |
| A failed send recorded nothing; an unset `RESEND_API_KEY` recorded undeliverable rows as **sent**. | `error` + `channel_attempted` on every row, with Twilio's numeric code. |
| A bulk coach reassignment blasted one message per session (376 rows on Jul 22). | Same-day repeats collapse to ~1 per person. |
| No cap, no quiet hours, no STOP. | All three. |
| Five per-type preference toggles covering a fraction of what we send. | Three grouped toggles; the unmutable list is deliberate data. |
| 20 parents got the **coach-worded** private message with a `/coach/session/` link they couldn't open. | Client copy has its own type and template. |
| Coaches and parents were sent to `"Adarsh Palm Retreat, Bengaluru, Bengaluru Urban, Karnataka, India"` instead of `"APR Apartments"`. | One resolver, `location_label()` — see §5. |
| The five arrival-flow WhatsApp templates were approved but their SIDs were never set, so those messages went out as **plain text**. | All 14 SIDs set (2026-07-31). |

---

## 4. Open, in priority order

Re-verified against production, Twilio and the deployed worker on 2026-07-31
(after the v31 deploy at 08:45 UTC).

1. **The replacement templates are approved. The secrets have not been swapped,
   so production is still sending localhost buttons.** Re-verified against the
   Twilio Content API on **2026-08-01**: all eight are `approved`. Until each
   secret is repointed, the v1 template — and its `http://localhost:3000` button
   — is what goes out. Confirmed live: the 2026-08-01 21:00 digest was delivered
   through the v1 template, whose "Open dashboard" button is
   `http://localhost:3000/admin`.

   | Secret | Swap to | Category | Fixes |
   | --- | --- | --- | --- |
   | `TWILIO_WA_CLIENT_PAYMENT_SID` | `HX879441494fa9930038c36a5a2fb8d97b` | UTILITY | localhost "Fix payment" button |
   | `TWILIO_WA_CLIENT_BOOKED_SID` | `HX332f153d408c4507df53a25aa3480669` | UTILITY | localhost button |
   | `TWILIO_WA_COACH_PRIVATE_SID` | `HXe084673761a0f11ba9bd339521e656bf` | UTILITY | localhost button |
   | `TWILIO_WA_FOUNDER_DIGEST_SID` | `HX63c20eab58f329c808ee32a79d4057d0` | UTILITY | localhost button — but prefer v3, below |
   | `TWILIO_WA_COACH_COMING_SID` | `HXa82dec3d1a321eb8c92c1dcaad5ba4af` | UTILITY | adds the `{{4}}` directions link |
   | `TWILIO_WA_COACH_ARRIVAL_SID` | `HX19dcfba57e024e8ed82294b02cafecce` | UTILITY | adds the `{{4}}` directions link |
   | `TWILIO_WA_CLIENT_WAITLIST_SID` | `HX9042cca9baba283cb1de5f2362978ae5` | UTILITY | MARKETING → UTILITY (item 2) |
   | ~~`TWILIO_WA_CLIENT_APPROVED_SID`~~ | ~~`HX2227fb519b2f87a20d511e6179b62227`~~ | **MARKETING** | **do not swap — see below** |

   `client_signup_approved_v2` came back **MARKETING** despite
   `allow_category_change: false`. Swapping to it would let a marketing opt-out
   suppress "your membership is approved", which is the one message a waiting
   applicant must receive — a worse defect than the dead button it fixes. It
   needs a v3 with copy Meta cannot read as promotional, not a swap. The v1 it
   replaces is UTILITY and delivers; only its button is dead.

   Two new secrets accompany the digest rewrite (§2a):

   | Secret | Set to | Why |
   | --- | --- | --- |
   | `TWILIO_WA_FOUNDER_DIGEST_V3_SID` | `founder_daily_digest_v3`, once approved | Four labelled lines instead of one run-on paragraph |
   | `APP_URL` | `https://sharwinacademy.com` | Confirm it is set on the *function*. Unset, the email fallback used to build `http://localhost:3000` deep links; the default is now production either way. |

   The worker picks its digest shape from which SID is set, so v3 can be
   provisioned and swapped independently of everything above.

   Check `category` as well as `status` on approval, then delete the v1s.
   **Never point a secret at a pending template** — unset falls back to the
   approved generic template, but an unapproved SID just fails.

   <details><summary>What the defect was, and why it can't recur</summary>

   Five approved templates had `http://localhost:3000` frozen into their button
   URL, including **Fix payment** — the button a parent taps when their card has
   failed. Dead for every recipient.

   `provision-templates.mjs` read `NEXT_PUBLIC_APP_URL` out of `.env.local`.
   That variable is set correctly in Vercel, but the script reads the file off
   disk, so it only ever sees the *local* value and never Vercel's — on a
   developer's machine that is always `http://localhost:3000`. It now reads a
   dedicated `WA_TEMPLATE_APP_URL`, defaults to production, and **refuses to run**
   against a non-https or localhost origin.

   The general rule: **a URL passed as a template *variable* is resolved at send
   time and is safe; a URL in a button `url:` is frozen at provision time.** That
   is why `coach_class_complete`'s link always worked — it arrives as `{{3}}`,
   built by the worker from its own (correct) `APP_URL` function secret.
   </details>

   Also verified while fixing this: Twilio **accepts extra `ContentVariables`**
   that a template doesn't declare, so the worker sending `"4": maps_url` to a
   3-variable v1 is harmless — confirmed by a clean send at 09:01 UTC and by 24
   test messages, all delivered.
2. **The live waitlist template is the MARKETING one.**
   `TWILIO_WA_CLIENT_WAITLIST_SID` sha256-matches `HXa77dad95…` =
   `client_waitlist_spot` v1, category **MARKETING** — billed higher *and*
   withheld from anyone who opted out of marketing, which is fatal for a
   15-minute offer. `client_waitlist_spot_v2` (UTILITY, transactional copy) is
   submitted and `pending`. Swap the SID on approval and delete v1. Untestable
   in production either way until item 8 fires.
3. **The phone-less founder account is still failing daily.** "Sharwin Table
   Tennis Academy" has no `phone` and no `wa_links`, so every escalation fanned
   out to it fails — **316 failed against 636 sent, all-time**. It is the
   original admin login and must not be deleted, so the fix is to either give it
   a phone or stop fanning escalations to it.
4. **Escalation volume is still high** — 120 in the 36h to 2026-07-31 (69
   not-arrived, 51 unconfirmed). The ladder only began working on the 30th, so
   this should fall on its own; re-check before building anything to suppress it.
5. **Delivery diagnostics are empty.** `error` and `channel_attempted` are NULL
   on *every* failed row, including today's, because the worker that writes them
   only deployed at 08:45 UTC on 2026-07-31. Nothing is wrong — but the two
   coaches failing with a phone on file (Keerthana 237, Augustine 79 all-time)
   cannot be diagnosed until fresh failures accrue. Re-check in a day.
6. **`0048_dead_notification_types.sql` is untracked and unapplied** — absent
   from `supabase_migrations.schema_migrations` and still `??` in `git status`.
   So all six phantom toggles (`new_class_open`, `payment_receipt`,
   `renewal_upcoming`, `assessment_ready`, `student_note`, `monthly_progress`)
   remain switches for messages that have never existed. The migration builds
   four; the two time-driven ones belong in the worker.
7. **`cover_offer`, `player_absent` and `session_outcome` have no Twilio
   template** — they degrade to plain text, and none has fired in production yet.
8. **`waitlist_spot` has never fired — not once.** The template, the expiry
   sweep and the `Claim spot`/`Pass` buttons are entirely unexercised. Possibly
   innocent (no class has filled and then freed a seat), but it means the whole
   claim path is unproven.
9. **`ops_payment_issue` / `ops_private_series_paused`** are named like feed
   items but are in neither `FEED_ONLY` nor the digest labels, so they would
   interrupt the founder *and* be invisible in the digest. **Neither has ever
   fired**, so this is a latent decision, not a live problem.
10. **`getCoachNames()` in `lib/booking.ts`** reads `profiles` directly and hits
    the RLS wall, so parents see a null coach name on `/app`. Fix is
    `public_coach_roster()`, as the bot tool already does.

### Leads worth checking

- **Group bookings may not be confirming.** 24 confirmed non-private bookings
  with a real client; only **2** carry a `booking_confirmed` row. The admin
  paths in `lib/admin-ops-calendar.ts` insert into `bookings` directly, bypassing
  the RPCs that queue it — the same shape as the private-reminder gap fixed in
  §3. Confirm before treating as a bug.
- **The daily cap silently drops schedule changes.** Two `session_moved` rows
  sit deferred to 08:00 IST on 1 Aug about a session on 30 Jul that has already
  happened; `CAP_DROP_AFTER_MS` bins them at the 3-day mark. For a high-traffic
  recipient the documented "held, not dropped" rule becomes "dropped".

---

## 4a. Coach adoption — measured against production, 2026-08-01

"Coaches aren't marking themselves as arrived." Measured, they mostly aren't:
**21 of 82 sessions (25%)** since the arrival ladder began working on 30 Jul,
and 106 of 436 (24%) across 30 days.

| Coach | Sessions | Confirmed | Arrived | Rate |
| --- | --- | --- | --- | --- |
| Nandhan | 18 | 9 | 6 | 33% |
| Samir | 14 | 6 | 3 | 21% |
| Keerthana | 14 | 5 | 4 | 28% |
| Nishchith | 12 | 6 | 2 | 16% |
| **Augustine Inigo** | 11 | **0** | **0** | **0%** |
| Sunil Hatti | 5 | 3 | 3 | 60% |
| Rushi Raj | 5 | 3 | 3 | 60% |
| **Sampath** | 3 | **0** | **0** | **0%** |

**The mechanism is not the problem.** Every check below passes:

- Delivery is clean — **zero** failed rows for any coach type since 30 Jul.
- Button ids in the live templates (`coach_arrived`, `coach_late`,
  `coach_confirm`, `coach_cant`) match `WA_BUTTON` in
  `lib/whatsapp/interactive.ts` exactly.
- Taps are landing: `coach_arrival_source = 'wa'` on 13 of Nishchith's and 12 of
  Nandhan's marks over 30 days.
- Augustine received 9 `coach_before_class`, 10 `coach_confirm_nudge_2` and 10
  `coach_arrival_check` over WhatsApp and answered **none** of them.

So this is adoption, concentrated in two coaches — not a delivery fault. Two
real defects sit underneath it, though:

1. **Sunil Hatti has no `wa_links` row**, so every prompt reaches him by
   *email*. He is the one coach never actually on WhatsApp, and (at 60%) among
   the better markers regardless — he taps in the app instead.
2. **246 founder escalations in three days** (132 `ops_coach_not_arrived`, 114
   `ops_coach_unconfirmed`). Past the point anyone reads them, which makes the
   escalation ladder self-defeating: the alert that matters is buried in the
   alert that doesn't. Worth suppressing repeats per coach per day before
   building anything else here.

`coach_arrival_source` is NULL on a meaningful minority of marks (17 of
Nandhan's, 8 of Nishchith's). Those predate the source column being written on
every path; not a live bug, but it means "how did they mark it?" can't be
answered for older rows.

---

## 5. Locations: venue + unit, stored not derived

A location is **two stored fields, chosen by a human at booking** — not a label
parsed out of an address string. Migrations `0052`–`0054`; design notes in
`docs/plans/location-model.md`.

| part | source | example |
| --- | --- | --- |
| venue name | `venues.name` via `classes.venue_id` | `Adarsh Palm Retreat` |
| venue unit | `venues.unit` | `Villas` |
| session unit | `private_class_details.unit_label` | `Clubhouse` |

Composed by `location_label(classes)` as `"<name> <venue unit>, <session unit>"`
→ **`Adarsh Palm Retreat Villas, Clubhouse`**. A private with no venue row falls
back to `private_class_details.venue_label`.

**Prefer `venue_id` over a stored string.** All 167 privates carry one, so
renaming a venue corrects every message it has ever appeared in — no backfill.
`venue_label` exists only for somewhere we hold no venue row for.

### The venue unit is a safety field

Within one complex the parts can be **mutually inaccessible**: a villa resident
cannot enter the towers' clubhouse, or the reverse. So the rule is that a
session's unit is never shown without its venue's unit — which holds by
construction, since `location_label` composes `venue_display` (carrying
`venues.unit`) before appending the session's own. The remaining hole is closed
in `saveVenueCore`: **if a venue shares its `name` with another, `unit` is
required**, so a bare `Adarsh Palm Retreat` is never selectable.

### Where it's read

**SQL** `location_label(classes)` is the authority — used by
`offer_cover_session`, `coach_mark_arrival`, `ops_notify_booking_created`,
`_create_private_occurrence`, and read by the notify worker and every app page
as a **PostgREST computed field** (`select=classes(title,location_label)`).

**TypeScript** `lib/venue-display.ts` no longer resolves anything. It holds only
the spelling helpers — `venueDisplayName`, `composeLocationLabel`,
`composeUnitLabel`, `venueNeedsUnit` — for the venue picker and the booking
preview, which have no class row to read. They mirror `venue_display(venues)`
and `location_label(classes)`; change one, change the other. Covered by
`tests/db/venue-label.test.ts` and `lib/venue-display.test.ts`.

`location_maps_url(classes)` gives directions for the message. It uses the
**private's own pin, not its venue's**, matching what `coach_mark_arrival`
geofences against — a map pointing elsewhere would send a coach to a spot that
then fails the arrival check.

### Read-time vs write-time — the distinction that hid a bug for a day

**A notification's `body` is frozen at INSERT.** Fixing a resolver repairs only
messages composed *after* the fix; anything already queued keeps its old text,
and old rows in the table keep it forever. So "I saw a message with a raw
address" is usually a message from before the fix, not a live bug — check
`created_at` before chasing it.

It also means the six writers had to be fixed in two different ways:

| Composed | Where | Fixed by |
| --- | --- | --- |
| At read/sweep time | `offer_cover_session`, `coach_mark_arrival`, `ops_notify_booking_created`, notify worker sweeps | calling `location_label` |
| At **booking** time | `_create_private_occurrence` (SQL), `lib/admin-ops-calendar.ts` (TS) | resolving *before* writing the body |

The last one matters most in practice: **~96% of privates are booked from
`/admin`**. That path had a `venue_id` in hand from its own dropdown and threw
it away, copying the venue's address onto the private instead — which is what
forced a resolver to exist at all. It now passes `venueId` through, and reads
`class_location_label` / `class_location_maps_url` rather than re-deriving
anything, so its string is byte-identical to every other path's.

### The series carries the location too

`private_booking_series` stores `venue_id` / `venue_label` / `unit_label`
(migration `0054`). Without it, the nightly `generate_private_sessions` would
re-derive a location for every week it materialises, so a correction made on a
series would silently revert on the next roll of the horizon.

### Four things not to undo

- **No distance tier in the resolver.** "Nearest venue within 150m" is gone and
  must not come back: **APR Tower 1 and APR Villas are 36 metres apart**. The
  booking wizard *does* offer venues within 500m — but as tappable suggestions a
  human confirms, never as a silent guess.
- **The venue unit is required when a name repeats.** See above: it's what stops
  "Clubhouse" naming two different, mutually inaccessible places.
- **Don't fold the maps URL into the location string.** The two templates that
  carry a location interpolate it mid-sentence, so a URL there is followed by a
  full stop that some clients swallow into the link. It rides as its own
  trailing `{{4}}`, and can't be a button — both are `twilio/quick-reply`
  templates, where a URL action can't sit alongside Yes/No buttons.
- **Don't auto-create a venue per private location.** Venues feed the admin
  manager and the public `/locations` page, so a client's own home must not
  become one. A place is promoted to a venue by a human, deliberately.

---

## 6. Operational lessons worth not relearning

- **Meta rejects terse templates** — `subCode 2388293`, "too many variables for
  its length". Keep plenty of literal text around the variables.
- **Content templates cannot be edited.** Delete and recreate; the provisioning
  script is idempotent by `friendly_name`.
- **Verify a function secret without reading it**: `supabase secrets list`
  returns a plain **sha256** of each value. Hash the expected value and compare.
- **Leaving a template SID unset is safe** (it falls back to the approved
  generic template). Pointing it at an unapproved template is worse than unset.
- **Meta silently re-categorises templates to MARKETING**, which are billed
  higher *and* withheld from marketing opt-outs. `client_waitlist_spot` was
  caught by this — fatal for a 15-minute "claim this spot" offer. Approval
  requests now send `allow_category_change: false` so a refusal is visible
  rather than silent; check `category`, not just `status`.
