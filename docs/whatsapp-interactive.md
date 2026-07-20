# WhatsApp interactive notifications

The academy talks to coaches, parents and the founder over WhatsApp (Twilio).
Coach-facing class prompts are **interactive** — quick-reply buttons that run the
exact same action as tapping in the app — instead of plain text. Everything
degrades gracefully: until the templates are approved, the same messages send as
text and typed replies still work.

Guiding principle for the **founder**: only notify them when an action is
actually expected of them. No happy-path spam.

## The day-to-day messages

### Coach — 1 hour before class (`coach_before_class`)
One interactive reminder with three buttons:

- **I'm coming** → `coach_confirm_session` (confirms the session)
- **I've arrived** → `coach_mark_arrival` (parents notified)
- **Running late** → `coach_mark_arrival(late)` (parents + founder notified)

Sent once per session, ~1 hour before it starts. Replaces the old day-before
nudge. A tap runs the RPC server-side with no LLM; we also accept the words
typed out ("coming" / "arrived" / "running late").

### Coach — after class (`coach_after_class`)
One interactive summary (never a string of separate texts), sent shortly after
the class ends:

- Congratulates them on finishing.
- Tells them their **next class today**, or congratulates them if that was their
  last one for the day.
- Links them to the session so they can **add an assessment note** for each
  student (opens the player profile / notes).
- Prompts them to **confirm attendance**, with buttons:
  - **All present ✅** → marks every booked student attended in one tap.
  - **Some absent** → deep-links the session so they can tick present/absent per
    player (they can also just reply "Aryan was absent").

### Founder — only when action is needed
- **Coach hasn't confirmed** (`ops_coach_unconfirmed`) — fires ~10 min before
  start if the coach still hasn't confirmed. (The routine "not confirmed yet"
  nudges were removed.)
- **Coach running late** (`coach_late`) — pushed by `coach_mark_arrival`.
- **Coach not marked arrived** (`ops_coach_not_arrived`) — fires once the class
  has started with no arrival marked.

Happy-path pings the founder used to get — "coach confirmed", "coach arrived" —
were removed (see migration `0029_founder_notification_philosophy.sql`).

### Parents (unchanged)
Coach arrived / running late, waitlist openings, booking confirmations, coach
changes, etc. still deliver as before.

## Where the logic lives

- **Sending + scheduling:** `supabase/functions/notify/index.ts` — the 1-minute
  cron worker. Sweeps `sweepBeforeClass`, `sweepFounderEscalations`,
  `sweepAfterClass` create the notifications; `deliverWhatsApp` sends the
  interactive template when a SID is configured and records the outbound Twilio
  message SID on the notification row.
- **Receiving taps:** `app/api/whatsapp/route.ts` routes button taps to
  `lib/whatsapp/interactive.ts`, which resolves the session (exact match via the
  recorded Twilio SID, else the coach's nearest session for that phase) and runs
  the action as the coach.
- **Templates:** `scripts/whatsapp/provision-templates.mjs` defines and submits
  them. The button `id`s there and in `lib/whatsapp/interactive.ts` must match.

## Provisioning

1. Ensure `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are in `.env.local`.
2. Create the templates and submit them for WhatsApp approval:
   ```
   node scripts/whatsapp/provision-templates.mjs
   ```
3. Approval is asynchronous — watch it in the Twilio Console (Messaging →
   Content Template Builder). Once **Approved**, set the SIDs on the edge
   function and redeploy if needed:
   ```
   supabase secrets set \
     TWILIO_WA_COACH_REMINDER_SID=HX... \
     TWILIO_WA_COACH_AFTERCLASS_SID=HX...
   ```

Until those SIDs are set, `coach_before_class` / `coach_after_class` send as
plain text (buttons omitted), and typed replies still drive the same actions.

## Edge-function environment

| Variable | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | Twilio auth + sender (already set) |
| `TWILIO_WA_TEMPLATE_SID` | Generic out-of-window utility template (already set) |
| `TWILIO_WA_COACH_REMINDER_SID` | Before-class quick-reply template |
| `TWILIO_WA_COACH_AFTERCLASS_SID` | After-class quick-reply template |
| `APP_URL` | Base URL for deep links in messages |

## Notes & limits

- WhatsApp quick-reply buttons are one-shot: there's no persistent "selected"
  state, so we confirm each tap with a short reply instead.
- Business-initiated interactive messages require an **approved** template; the
  24h-window free-form path doesn't apply to them, which is why provisioning +
  approval is a prerequisite for the buttons (text fallback covers the gap).
