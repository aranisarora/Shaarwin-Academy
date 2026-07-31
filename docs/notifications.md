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

1. **The phone-less founder account is still failing daily.** "Sharwin Table
   Tennis Academy" has no `phone` and no `wa_links`, so every escalation
   fanned out to it fails — **41 of the 66 failures in the last three days**.
   It is the original admin login and must not be deleted, so the fix is to
   either give it a phone or stop fanning escalations to it.
2. **Escalation volume is still high.** ~50/day on 2026-07-30 across the two
   escalation types. The ladder only began working on the 30th, so this should
   fall on its own — re-check before building anything to suppress it.
3. **Two coaches fail delivery with a phone on file** (Augustine 9, Keerthana 8
   in three days) — worth reading `error` on those rows now that it's recorded.
4. **`ops_payment_issue` / `ops_private_series_paused`** are named like feed
   items but are in neither `FEED_ONLY` nor the digest labels, so they interrupt
   the founder *and* are invisible in the digest. One-line fix, needs a decision.
5. **`getCoachNames()` in `lib/booking.ts`** reads `profiles` directly and hits
   the RLS wall, so parents see a null coach name on `/app`. Fix is
   `public_coach_roster()`, as the bot tool already does.
6. **Six types are wired into the preferences UI but nothing ever sends them** —
   `new_class_open`, `payment_receipt`, `renewal_upcoming`, `assessment_ready`,
   `student_note`, `monthly_progress`. Members can toggle switches for messages
   that have never existed. An unapplied migration
   (`0048_dead_notification_types.sql`) builds four of the six; the two
   time-driven ones belong in the worker.
7. **`cover_offer` and `player_absent` have no Twilio template** — they degrade
   to plain text.

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
