# Notification fix — actions only the owner can take

Companion to `docs/notification-fix-plan.md`. Everything in the plan that an
agent can build is being built; this file is the list of things that need your
hands, your Twilio console, or your decision. Written 2026-07-29 against a live
read-only audit.

---

## 1.1 — Deploy the notify worker (BLOCKING, do this first)

**The plan's diagnosis is confirmed, exactly.** I pulled the deployed source
(edge function `notify`, version 26, updated Jul 24) and diffed it against
`supabase/functions/notify/index.ts`:

| Deployed v26 | Repo (what will deploy) |
| --- | --- |
| No `sweepCoachConfirmNudge` function at all | present (T-30 coach nudge) |
| No `sweepArrivalCheck` function at all | present (T-0 "have you reached?") |
| Only 5 sweeps registered | 7 sweeps registered |
| `ops_coach_unconfirmed` filters on `coach_confirmed_at` **only** | filters on `coach_confirmed_at` **and** `coach_arrived_at` |
| `coach_before_class` → `TWILIO_WA_COACH_REMINDER_SID` | → `TWILIO_WA_COACH_COMING_SID` |
| `deliver()` returns bool, failures anonymous | returns an attempt result, writes `error` + `channel_attempted` |

That is the whole reason `coach_confirm_nudge_2` and `coach_arrival_check` have
**zero rows ever** — the code to write them is not running in production.

**Command:**

```bash
supabase functions deploy notify --project-ref jkjgdpifimvnptpxjixk
```

Deploy from `main` after the Phase-1 commits are pushed, so the deploy carries
both the arrival ladder (1.1) and the delivery-error columns (1.5).

**Why I stopped here:** the plan's rails say prepare everything then ask, because
this changes live message behaviour. It will start two new coach messages
(T-30 nudge, T-0 arrival check) and should *reduce* founder escalations.

**Done when:** `coach_confirm_nudge_2` and `coach_arrival_check` rows appear
within one class day, and `ops_coach_unconfirmed` stops firing for sessions
whose coach has `coach_arrived_at` set.

---

## 1.3 — The founder accounts (DECISION NEEDED)

There are **three** `founder` profiles, not two. Every escalation fans out to
all three, which is a volume multiplier the plan didn't account for:

| Profile | Email | Phone | `wa_links` | Escalations ever | Failed | Sent |
| --- | --- | --- | --- | --- | --- | --- |
| Sharwin Table Tennis Academy | sharwinttacademy@gmail.com | — | **0** | 359 | **243** | 116 |
| Stalin | stalin@sharwinacademy.com | +918431435758 | 1 | 359 | 0 | 359 |
| Aranis (you) | aranis.arora@gmail.com | +918904506670 | **0** | 12 | 0 | 12 |

Over the last 3 days: **40 distinct sessions** escalated, producing **146 rows**
— ~3.65 rows per escalated session, purely from the fan-out.

**Your call, three options:**

- **(a) Demote/retire "Sharwin Table Tennis Academy"** — recommended. It has no
  phone and no WhatsApp link, and it's a shared org mailbox rather than a
  person. Changing its `role` off `founder` ends ~15–25 failed rows/day *and*
  cuts total escalation volume by a third. Nothing else uses it.
- **(b) Link a phone to it** via the existing verified-phone path (insert
  `wa_links`). Ends the failures but keeps the 3× fan-out — you'd then have two
  phones buzzing for the same silent coach.
- **(c) Leave it, and instead route escalations to one founder.** Bigger change;
  belongs in Phase 2 rather than here.

Note your own account also has **no `wa_links` row** despite having a phone —
so you're receiving escalations by email, not WhatsApp. If you expected
WhatsApp, that's a second thing to link.

---

## 1.4 — Provision the WhatsApp templates

```bash
npm run wa:provision
```

Then wait for Meta's review queue and set the SIDs (1.4b below).

**Two things the script cannot do:**

1. **Build `TWILIO_WA_TEMPLATE_SID` by hand** in Twilio Console → Messaging →
   Content Template Builder. Generic Utility template, two variables:
   `{{1}}` = first name, `{{2}}` = the message. This is the catch-all used for
   any notification type without a dedicated template when the recipient is
   outside the 24h service window. Without it those sends now fail with the
   explicit reason `outside_24h_window_and_no_generic_template`.
2. **Approval itself** — Meta's queue, not scriptable.

**Already done for you (committed):** the retired three-button
`coach_class_reminder` template is no longer created or submitted (G12).

---

## 1.4b — Exact function secrets to verify

Set on the **notify edge function** (Supabase Dashboard → Edge Functions →
notify → Secrets, or `supabase secrets set`). A name mismatch fails *silently*:
the worker treats an unset SID as "no template" and quietly downgrades.

**Required — the worker reads all of these:**

```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_FROM          # "whatsapp:+1..."
APP_URL
RESEND_API_KEY
TWILIO_WA_TEMPLATE_SID        # the hand-built generic one (1.4)
TWILIO_WA_COACH_COMING_SID    # ← NOT ..._COACH_REMINDER_SID
TWILIO_WA_COACH_ARRIVAL_SID
TWILIO_WA_COACH_AFTERCLASS_SID
TWILIO_WA_COACH_PRIVATE_SID
TWILIO_WA_CLIENT_REMINDER_SID
TWILIO_WA_CLIENT_WAITLIST_SID
TWILIO_WA_CLIENT_PAYMENT_SID
TWILIO_WA_CLIENT_BOOKED_SID
TWILIO_WA_CLIENT_ARRIVED_SID
TWILIO_WA_CLIENT_LATE_SID
TWILIO_WA_CLIENT_APPROVED_SID
TWILIO_WA_FOUNDER_DIGEST_SID
TWILIO_WA_FOUNDER_SIGNUP_SID
```

**Safe to delete:** `TWILIO_WA_COACH_REMINDER_SID` — nothing reads it after the
deploy in 1.1.

I can't read function secrets over the MCP, so I can't tell you which are
currently missing. After the 1.1 deploy you won't have to guess: every failed
row will name its own reason, so

```sql
select type, error, count(*) from notifications
 where status='failed' and created_at > now() - interval '1 day'
 group by 1,2 order by 3 desc;
```

will list the unprovisioned templates directly.

---

## Extra finding — check the Resend sender domain

Not in the plan, but it falls out of the 1.3 numbers and is worth 5 minutes.

The worker sends email as `Sharwin TTA <notify@resend.dev>`. `resend.dev` is
Resend's **shared test domain**, which by policy can only deliver to the email
address that owns the Resend account. That fits the data exactly:

- **Aranis** (likely the Resend account owner) — 0 failed rows.
- **Sharwin Table Tennis Academy** (a different gmail) — 243 failed escalations,
  despite having a valid email on file.

So the email fallback is probably working *only for you*, and every other
unlinked user's fallback is silently bouncing. If that's right, verifying a real
sending domain in Resend and changing the `from:` address fixes a whole class of
failures that has nothing to do with WhatsApp.

Confirm after the 1.1 deploy — a `403`/`validation_error` in the new `error`
column on those rows proves it in one query.
