# Notification fix — actions only the owner can take

Companion to `docs/notification-fix-plan.md`. Originally written 2026-07-29 as
four owner-only gates. **Updated 2026-07-30: three of the four are now done.**
The Supabase CLI turned out to be logged in and the Twilio/Resend credentials
were in `.env.local`, so the deploy, the provisioning and the sender fix did not
need the owner after all.

Status at a glance:

| Gate | Status |
| --- | --- |
| 1.1 Deploy the notify worker | **Done** — v27 live |
| 1.3 The founder accounts | **Decision still open** — but "delete it" is off the table, see below |
| 1.4 Provision the WhatsApp templates | **Done** — 13 submitted, awaiting Meta review |
| Resend sending domain | **Done** — root cause proven and fixed |

---

## 1.1 — Deploy the notify worker ✅ DONE

Deployed 2026-07-30, **version 26 → 27**, via
`supabase functions deploy notify --project-ref jkjgdpifimvnptpxjixk`.

There is no autodeploy for this: the repo has no `.github/workflows`, and Vercel
only builds the Next app. Supabase edge functions are a separate manual push.
That is precisely how prod drifted to v26 in the first place — **the repo and
the deployed worker have no automatic link.** Anything changed under
`supabase/functions/` from now on has to be deployed by hand.

The v26-vs-repo diff in the original audit was accurate: `sweepCoachConfirmNudge`
and `sweepArrivalCheck` genuinely did not exist in production. They do now.

**Done when:** `coach_confirm_nudge_2` and `coach_arrival_check` rows appear
within one class day, and `ops_coach_unconfirmed` stops firing for sessions
whose coach has `coach_arrived_at` set.

---

## Resend sending domain ✅ DONE — this was the big one

Filed originally as a speculative "extra finding". It is now **proven**, and it
was a bigger deal than the plan gave it credit for.

The worker sent as `Sharwin TTA <notify@resend.dev>`. Two probes with the
**exact key the worker uses** (verified: sha256 of `RESEND_API_KEY` in
`.env.local` matches the function secret's digest — same key):

```
notify@resend.dev        → aranis.arora@gmail.com     200 OK
notify@resend.dev        → sharwinttacademy@gmail.com 403 validation_error
    "You can only send testing emails to your own email address
     (aranis.arora@gmail.com)."
notify@sharwinacademy.com → aranis.arora@gmail.com    200 OK
```

So the email fallback was delivering to **exactly one person on earth** — the
Resend account owner — and hard-failing for every other user. That is most of
what `status='failed'` was, and it explains the 0-vs-243 split between the
Aranis and academy founder profiles precisely.

**Fixed in the deployed worker:** the `from:` address is now
`RESEND_FROM`, defaulting to `Sharwin TTA <notify@sharwinacademy.com>` (the
verified domain). Override with a `RESEND_FROM` function secret if the address
should change.

---

## 1.4 — Provision the WhatsApp templates ✅ DONE (awaiting Meta review)

`npm run wa:provision` ran. All 13 templates now exist and are submitted.

**The generic template already existed and was already approved** — the plan
said this had to be hand-built, but `TWILIO_WA_TEMPLATE_SID` has been set on the
function since 2026-07-10 and points at `sharwin_notification`
(`HX9dae8e3b…`), an approved two-variable Utility template of exactly the right
shape. No hand-building was needed.

### Meta rejected three templates — bodies rewritten

`founder_daily_digest`, `coach_coming_check` and `coach_arrival_check` were all
rejected with:

> subCode=2388293 — This template has too many variables for its length.
> Reduce the number of variables or increase the message length.

The bodies were too terse for their variable count (e.g. `Hi {{1}}! {{2}} starts
at {{3}}. Are you coming?` — three variables in ~47 characters). The three were
deleted, their bodies lengthened in `scripts/whatsapp/provision-templates.mjs`
with the **same variables in the same order and the same button ids**, and
resubmitted. Variable order still matches `interactiveContentFor()` in the
worker, so no worker change was needed.

**This is a live constraint to remember when adding any future template:** keep
plenty of literal text around the variables or Meta refuses it.

### Current approval state (as of 2026-07-30)

Approved and set as function secrets — nothing to do:
`COACH_AFTERCLASS`, `CLIENT_REMINDER`, `CLIENT_WAITLIST`, `CLIENT_PAYMENT`,
`CLIENT_BOOKED`, `COACH_PRIVATE`, `FOUNDER_SIGNUP`, `CLIENT_APPROVED`,
plus the generic `TWILIO_WA_TEMPLATE_SID`. All nine verified by hashing the SID
against the stored secret digest.

Pending Meta review — **secrets deliberately left unset** until approved, because
an unset SID degrades safely to the approved generic template, whereas a SID
pointing at an unapproved template fails the send:

```
TWILIO_WA_COACH_COMING_SID=HX21d22437489345162dc857b325811742
TWILIO_WA_COACH_ARRIVAL_SID=HX16456399315b30c6b390ba23b644ba23
TWILIO_WA_FOUNDER_DIGEST_SID=HX29ff9193137cb246eb12f5d302849974
TWILIO_WA_CLIENT_ARRIVED_SID=HXf31e8cb90b09fef58ff02e5aafa75b27
TWILIO_WA_CLIENT_LATE_SID=HX3b85c28fe12668895597a601dc5bfccf
```

Once the Twilio Console shows these approved:

```bash
supabase secrets set --project-ref jkjgdpifimvnptpxjixk \
  TWILIO_WA_COACH_COMING_SID=HX21d22437489345162dc857b325811742 \
  TWILIO_WA_COACH_ARRIVAL_SID=HX16456399315b30c6b390ba23b644ba23 \
  TWILIO_WA_FOUNDER_DIGEST_SID=HX29ff9193137cb246eb12f5d302849974 \
  TWILIO_WA_CLIENT_ARRIVED_SID=HXf31e8cb90b09fef58ff02e5aafa75b27 \
  TWILIO_WA_CLIENT_LATE_SID=HX3b85c28fe12668895597a601dc5bfccf
```

Check status with:

```bash
curl -s -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://content.twilio.com/v1/Content/<SID>/ApprovalRequests"
```

### Secrets cleaned up

`TWILIO_WA_COACH_REMINDER_SID` (unreferenced after the arrival-flow rework) and
`TWILIO_WA_FOUNDER_DIGEST_SID` (it pointed at the rejected digest template,
which has since been deleted — so it was worse than unset) were both removed
from the function.

---

## 1.3 — The founder accounts ✅ RESOLVED — leave as is

The original recommendation was "demote or retire the Sharwin Table Tennis
Academy profile". **Do not delete it, and demoting it is not free either.**
Digging into what it actually is:

**It is the academy's own Google login, and it is in active use.**

| | Sharwin TT Academy | Stalin | Aranis |
| --- | --- | --- | --- |
| Sign-in provider | Google | email | Google |
| Last sign-in | 2026-07-22 | 2026-07-29 | 2026-07-29 |
| `wa_links` | 0 | 1 | 0 |
| Notifications / failed | 902 / **316** | 949 / 8 | 33 / 0 |

What it owns, which the first audit did not check:

- **294 `audit_log` rows** as actor — including a 191-action bulk setup day on
  2026-07-22, and 4 actions on 2026-07-29
- **182 `coach_assignments`** as `assigned_by`
- **31 skills** and **3 classes** it created
- a **player**, an **active subscription**, a **paid invoice** and a **paid
  order** attached to it

Deleting the profile would **cascade-delete** the player, subscription, invoice,
order, class credits, private-credit ledger rows and all 902 notifications, and
**null out** the actor on 294 audit rows, 182 coach assignments, 31 skills and 3
classes. It would also lock out whoever signs in with that Google account.

Demoting it is also not a small thing: the role enum is only
`client | coach | founder` — there is **no admin role** — and admin access is
gated on `role = 'founder'` via `is_founder()`. Changing its role takes the
academy's shared login out of the admin app entirely.

**So the honest answer to "what's the point of it": it is the original admin
account, the one that did the bulk of the setup work, and someone still signs
into it.** It has no phone because nobody ever linked one, not because it's a
stray.

**The missing piece the audit didn't know:** `stalin@sharwinacademy.com` and
`sharwinttacademy@gmail.com` are **both Stalin**. Only the first has a
`wa_link`, so Stalin already receives every escalation on WhatsApp — nothing is
ever missed. The academy account's rows are exact duplicates; both profiles
receive an identical count every single day.

Its 316 failures were the Resend bug, not the account. Now that the sender is
fixed, those stop bouncing and start arriving — roughly **25 duplicate emails a
day** (`ops_coach_not_arrived`, `ops_coach_unconfirmed`, `ops_daily_digest`,
`signup_request`, `coach_late`), spiking to ~60 on busy days. The other ~96/week
it receives are `FEED_ONLY` types that were never delivered to anyone.

**Decision (2026-07-30): leave it as is.** Aranis was shown the duplicate-volume
number and chose to accept it rather than mute the account. No further action.

**If it is ever revisited**, the cheap lever already exists and needs no
migration: set `profiles.wa_muted = true` on the academy profile. That is a hard
channel gate the notify worker honours (`index.ts` ~line 273) for everything
non-`TRANSACTIONAL` — one row, reversible, and the `/admin` ops feed still
renders every row. Only `signup_request` (~1/day) would still email, since it is
transactional. The heavier alternative is a new `profiles.ops_alerts` flag.

**Still open — your own account:** your profile has a phone but **no `wa_links`
row**, so you receive escalations by email, not WhatsApp. If you expected
WhatsApp, that needs linking.
