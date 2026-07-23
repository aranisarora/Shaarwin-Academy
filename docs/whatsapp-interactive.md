# WhatsApp notifications

The academy talks to coaches, parents and the founder over WhatsApp (Twilio).
The guiding rule: **a WhatsApp message must be actionable or time-sensitive for
its recipient.** Everything else lives in the in-app feed (and, for the founder,
one daily digest). Interactive messages carry quick-reply / call-to-action
buttons that run the **exact same action as the app**, deterministically, with
no LLM. Everything degrades gracefully: until a template is approved, its
message sends as plain text and typed replies still work.

## Delivery policy (the notify worker)

`supabase/functions/notify/index.ts` is a 1-minute cron worker that delivers
`notifications` rows. Three routing rules run before delivery:

1. **Feed-only** (`FEED_ONLY`) — the founder ops firehose (`ops_booking`,
   `ops_cancellation`, `ops_attendance`, `ops_payment`, `ops_membership`,
   `ops_new_client`, `ops_new_coach`, `ops_player_added`, `ops_wa_linked`,
   `ops_credit_used`, `ops_coach_change`) is **never** sent over WhatsApp/email.
   The row is claimed (flipped to `sent`) and left for `/admin` to render.
2. **Quiet hours** (`DEFERRABLE`) — non-urgent types that come due inside IST
   **[21:30, 08:00)** are pushed to the next 08:00 IST instead of pinging
   overnight. Time-bound types (reminders, waitlist, arrivals, escalations) are
   never deferred. `payment_failed` bypasses *prefs* (it's transactional) but is
   still deferred — nobody fixes a card at 2am; the two sets are kept separate.
3. **Prefs** — non-transactional types respect `profiles.notification_prefs`
   (`=== false` disables).

Then WhatsApp-first delivery: an approved interactive/CTA template when one is
configured for the type (business-initiated, any time), else free-form text
inside the 24h service window, else the generic utility template, else email.

## Founder daily digest

The ops firehose is feed-only, so `sweepFounderDigest` rolls each IST day's
activity into **one line** — `12 bookings · 2 cancellations · 1 new client` —
sent once per founder at/after **21:00 IST** (type `ops_daily_digest`, links to
`/admin`). Zero-activity days send nothing. Single line on purpose: template
variables reject newlines, and outside the window it rides the digest template.

The founder's WhatsApp is now **escalations + the digest only**:
`ops_coach_unconfirmed` (~10 min before start, coach hasn't confirmed),
`ops_coach_not_arrived` (class started, no arrival), `coach_late` (pushed by the
coach), plus the other genuine escalations.

## Coach messages

### 1 hour before class (`coach_before_class`)
Interactive reminder, buttons:
- **I'm coming** → `coach_confirm_session`
- **I've arrived** → `coach_mark_arrival` (parents notified)
- **Running late** → `coach_mark_arrival(late)` (parents + founder notified)

Typed words work too ("coming" / "arrived" / "running late").

### After class (`coach_after_class`)
One interactive summary: congratulations, their next class today (or "done for
the day"), a link to add per-student assessment notes, and attendance buttons:
- **All present** → marks every booked student attended in one tap.
- **Some absent** → replies a **numbered roster**; the coach replies with the
  numbers (e.g. `2 4`, or `0` if everyone made it). Digits-only replies within
  2h of the prompt mark those bookings `no_show` and the rest `attended` — the
  same statuses the app's attendance UI writes. No extra template needed: the
  tap opened a service window so the follow-up is free-form.

### New private session (`new_private_session`)
CTA template with a **View session** button deep-linking to the session page.

## Client messages

### Session reminder (`reminder_upcoming`)
**One** reminder ~3h before the session (the old `reminder_24h` + `reminder_2h`
pair was consolidated — see `0036_reminder_consolidation.sql`). Buttons:
- **I'll be there** (`rem_yes`) → a one-line ack, no DB write (the tap opens a
  free 24h window — that's the win).
- **Can't make it** (`rem_no`) → cancels the booking immediately via
  `cancel_booking` (same RPC as the app), one tap, no confirm step; replies with
  the rebook link. Reminders are per-booking, so siblings get separate messages
  and each tap is unambiguous.

### Waitlist opening (`waitlist_spot`)
Buttons:
- **Claim spot** (`wl_claim`) → `claim_waitlist_spot` promotes the caller's
  waitlisted booking to confirmed if a seat is still free, else a friendly "just
  taken". (Added in `0037_claim_waitlist_spot.sql`; reusable by the app.)
- **Pass** (`wl_pass`) → marks the offer read; `sweepWaitlistOffers` then offers
  the next family on the next tick (an instant pass instead of the timeout).

### Payment failed / booking confirmed
CTA templates with **Fix payment** (→ `/app/billing`) and **View schedule** (→
`/app/schedule`) buttons.

Client button handling is **taps only** — a payload id, or an exact button title
paired with the replied-to message. No loose-word matching; any free text falls
through to the assistant.

## Where the logic lives

- **Sending + scheduling:** `supabase/functions/notify/index.ts`. Sweeps create
  the notification rows; `deliverWhatsApp` → `interactiveContentFor()` picks the
  template by type and records the outbound Twilio SID on the row (so an inbound
  tap can be mapped back).
- **Receiving taps:** `app/api/whatsapp/route.ts` routes coach **and** client
  taps to `lib/whatsapp/interactive.ts`, which gates by role, resolves context
  (coach: the recorded SID or the nearest session for the phase; client: the
  recorded SID only) and runs the action. Anything unrecognised falls through to
  the LLM assistant (`lib/whatsapp/agent.ts`), which is unchanged.
- **Templates:** `scripts/whatsapp/provision-templates.mjs` is the single
  registry — it defines and submits every template. The button `id`s there,
  the ids in `lib/whatsapp/interactive.ts`, and the variable order in
  `interactiveContentFor()` must all match.

## Template registry

All templates are `language: "en"`, submitted as **UTILITY** (marketing
templates are ~7× the cost — never used). WhatsApp rules the definitions obey:
no adjacent variables, no variable at the start/end of a body, no
emojis/formatting in button titles, no newlines in variable values.

| Env key | friendly_name | Kind |
| --- | --- | --- |
| `TWILIO_WA_COACH_REMINDER_SID` | `coach_class_reminder` | quick-reply |
| `TWILIO_WA_COACH_AFTERCLASS_SID` | `coach_class_complete` | quick-reply |
| `TWILIO_WA_CLIENT_REMINDER_SID` | `client_session_reminder` | quick-reply |
| `TWILIO_WA_CLIENT_WAITLIST_SID` | `client_waitlist_spot` | quick-reply |
| `TWILIO_WA_CLIENT_PAYMENT_SID` | `client_payment_issue` | call-to-action |
| `TWILIO_WA_CLIENT_BOOKED_SID` | `client_booking_confirmed` | call-to-action |
| `TWILIO_WA_COACH_PRIVATE_SID` | `coach_private_session` | call-to-action |
| `TWILIO_WA_FOUNDER_DIGEST_SID` | `founder_daily_digest` | call-to-action |

Until each SID is set the matching message sends as plain text (buttons omitted)
and typed replies still drive the same actions.

## Provisioning (manual — founder/operator)

1. Ensure `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` are in `.env.local`.
2. `npm run wa:provision` — creates the templates and submits them for approval
   (idempotent by friendly_name).
3. Watch approval in the Twilio Console (Messaging → Content Template Builder) —
   asynchronous, usually minutes–hours.
4. Once **Approved**, set the SIDs on the edge function and it starts sending the
   interactive versions automatically:
   ```
   supabase secrets set \
     TWILIO_WA_COACH_REMINDER_SID=HX... TWILIO_WA_COACH_AFTERCLASS_SID=HX... \
     TWILIO_WA_CLIENT_REMINDER_SID=HX... TWILIO_WA_CLIENT_WAITLIST_SID=HX... \
     TWILIO_WA_CLIENT_PAYMENT_SID=HX... TWILIO_WA_CLIENT_BOOKED_SID=HX... \
     TWILIO_WA_COACH_PRIVATE_SID=HX... TWILIO_WA_FOUNDER_DIGEST_SID=HX...
   ```
5. Spot-check one live round-trip per button on a real phone.

## Edge-function environment

| Variable | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | Twilio auth + sender |
| `TWILIO_WA_TEMPLATE_SID` | Generic out-of-window utility template |
| `TWILIO_WA_*_SID` (table above) | Interactive / CTA templates |
| `APP_URL` | Base URL for deep links |

## Notes & limits

- WhatsApp quick-reply buttons are one-shot: no persistent "selected" state, so
  each tap gets a short confirming reply.
- Business-initiated interactive messages require an **approved** template; the
  24h-window free-form path doesn't apply to them, which is why provisioning +
  approval is a prerequisite for buttons (text fallback covers the gap).
- WhatsApp **Flows** (in-chat forms) are deliberately **not** built — the
  quick-reply / CTA / numbered-reply surface covers the high-value cases at a
  fraction of the complexity. See `docs/whatsapp-upgrade-plan.md` Part 8.
