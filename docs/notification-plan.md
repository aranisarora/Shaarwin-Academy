# Notification plan

The complete set of notifications the academy should send, per role, with the
exact information each carries. This is the **target state**. For what is
currently built, and why, see `whatsapp-messaging.md`.

Status key: ✅ exists · ⚠️ exists but incomplete · ❌ built but never fires · 🆕 new

---

## 1. Rules

**Send only when someone must act, or must be reassured.** Everything else is
the in-app feed.

**One message per event, per person.** Not per booking, per player, or per
session. A parent with two children in one day gets one message; a coach with
three sessions gets one morning brief.

**Carry only what the decision needs.** Every field must answer "what do I do
now?" or "am I safe to do nothing?". If a recipient can act without a field,
cut it.

**Never leak internals.** No ids, no enum values, no jargon. The current
`ops_cancellation` ends with *"Reason: in_window."* — a raw database enum in a
sentence a human reads. That's the failure mode this rule prevents.

**Say the thing, don't link to it.** "Check your schedule" is a message that
failed. Put the fact in the message; use the link for depth.

**Every fact in the prose goes in the payload too.** Templates read only the
structured payload — a fact written to prose alone renders as a generic
fallback.

---

## 2. Information each role needs

Completeness is measured against these needs, not against a list of features.
Every need must map to at least one message in §3–§5.

| | Client (parent) | Coach | Founder |
| --- | --- | --- | --- |
| **1** | Can I use this? | Am I on the team? | Who is waiting on me? |
| **2** | What have I committed to? | What am I teaching, when, where? | Is today covered? |
| **3** | What's happening today? | Who am I teaching? | What's failing right now? |
| **4** | Has anything changed? | Has my schedule changed? | What money came in? |
| **5** | Is my child safe and supervised? | What do I owe the academy? | What money is at risk? |
| **6** | Did my child attend? | What work is available? | Who is about to leave? |
| **7** | Is my child improving? | Where do I stand on requests? | Is supply matching demand? |
| **8** | What am I paying, and when? | | Is coaching quality holding? |
| **9** | What do I have left? | | |

---

## 3. Client notifications

The client is a parent who is not present. Messages assume they cannot see the
session and the child will not report on it.

| ID | Message | Trigger | Information carried | Buttons | Status |
| --- | --- | --- | --- | --- | --- |
| **C0** | Invitation | founder invites a phone number | who invited them, what the academy is | Accept invite | 🆕 |
| **C1** | Welcome + free trial | account created | that a free trial exists; how to use it | Book my free class | 🆕 |
| **C2** | Trial unused | day 3 and day 10, then stop | one suggested slot (day + time) | See class times | 🆕 |
| **C3** | Access approved | founder approves signup | that they're in; next step | Open the app | ✅ |
| **C4** | Booking confirmed | booking created | player, class, day + time, venue | View schedule | ⚠️ no time/class in payload |
| **C5** | On the waitlist | booking waitlisted | player, class, day + time, position | — | 🆕 |
| **C6** | Spot open | a confirmed seat frees | class, day + time, minutes to claim | Claim · Pass | ❌ never fires |
| **C7** | Today | 08:00 on days with sessions | per player: class, time, venue, coach name | — | 🆕 |
| **C8** | Schedule changed | session moved, rescheduled, class edited | player, class, **old → new** time or venue | View schedule | ⚠️ payload has no session |
| **C9** | Cancelled | session, class or series cancelled | class, day + time, effect on allowance/minutes | — | ✅ |
| **C10** | Coach arrived / late | coach marks arrival or late | coach name, venue, session time | — | ⚠️ name missing on most |
| **C11** | Session outcome | attendance marked | player, attended or absent, what was worked on, any rating that moved | See progress | 🆕 |
| **C12** | Monthly progress | first week of month, per player | sessions attended / booked, top 3 skill movements, one coach comment | Full report | 🆕 |
| **C13** | Payment received | invoice or order paid | amount, what it bought, period covered | — | 🆕 |
| **C14** | Renewing soon | 3 days before period end | date, amount, plan name | — | 🆕 |
| **C15** | Payment failed | subscription past due | plan, amount, deadline before access stops | Fix payment | ⚠️ payload empty |
| **C16** | Membership changed | paused, cancelled or recovered | new state, effect on booked sessions and slot | — | 🆕 |
| **C17** | Balance running out | minutes low, or expiring in 3 days | balance remaining, expiry date | Book a session | ⚠️ partial |
| **C18** | Announcement | founder broadcast | free text | — | ✅ |

**Merged deliberately.** C11 replaces a separate "attended" and "absent"
message, and folds in the assessment — one message per player per session.
C7 replaces both the evening-before and the 3-hour reminder.

**C4 on a household's first booking** additionally carries arrival time, what to
bring, and parking — as a variant of the confirmation, not a second message.

**Excluded deliberately.** Coach identity on C4 (it can change before the
session — C7 and C10 carry it when it's final). Booking ids, invoice line items,
retry schedules, waitlist position on C6 (it's a race — position is noise).

---

## 4. Coach notifications

The coach is peripatetic, paid per session, and the single point of failure for
every class. Messages are built so that "will this session happen?" is answered
progressively earlier.

| ID | Message | Trigger | Information carried | Buttons | Status |
| --- | --- | --- | --- | --- | --- |
| **K1** | Invitation | coach invite created | who invited them; what to do | Accept | 🆕 |
| **K2** | You're a coach now | role granted | what the app and bot can now do for them | — | ✅ |
| **K3** | Your day | 07:00 on days with sessions | each session: time, class, venue, headcount, count of new students; assessments outstanding | All confirmed · Something's wrong | 🆕 |
| **K4** | Starting in an hour | T-60 | class, time, venue, headcount | Coming · Can't make it *(only if unconfirmed)* | ⚠️ no headcount |
| **K5** | Have you arrived? | T-0, no arrival marked | class, venue | I've arrived · Running late | ❌ never fires |
| **K6** | Session wrap | after session ends | class taught, next session today, what's owed | All present · Some absent | ✅ |
| **K7** | Schedule changed | assigned, reassigned, moved, cancelled | which session, **old → new**, and whether it's cover | View session | ⚠️ payload has session only |
| **K8** | Cover available | session has no coach | class, day + time, venue | I'll take it · Not free | 🆕 |
| **K9** | Assessments outstanding | weekly, if any | how many, which players | Add notes | 🆕 |
| **K10** | Time off | on request, and on decision | dates, outcome, whether sessions are covered | — | ⚠️ no ack on request |
| **K11** | Announcement | founder broadcast | free text | — | ✅ |

**K3 absorbs the confirmation ladder.** *All confirmed* stamps every session
that day, which the existing T-30 and T-10 sweeps already treat as "no need to
chase". K4 then drops its buttons and becomes informational.

**Arrival is never absorbed.** K5 and the T+10 founder escalation stay
regardless of what was confirmed at 07:00 — intent is not presence.

**Excluded deliberately.** Student names in K3 (headcount plus *"1 new"* is
what changes behaviour; names are one tap away). Parent contact details.
Anything about other coaches' sessions.

---

## 5. Founder notifications

The founder can see everything in-app, so the only question is what earns a
push. Two rules: **push only what expires**, and **name people and money**.

| ID | Message | Trigger | Information carried | Buttons | Status |
| --- | --- | --- | --- | --- | --- |
| **F1** | Today | 07:00 | class count and student count; **exceptions first** (sessions with no coach, approvals waiting — signups and time-off requests, members past due with a session today); each session: time, class, venue, coach, booked/capacity; money due today; trials booked today | Open dashboard | 🆕 |
| **F2** | Approval needed | signup request | name, email, phone | Approve · Deny | ✅ |
| **F3** | Coach hasn't confirmed | T-10, no response | coach name and phone, class, time | — | ✅ |
| **F4** | Coach hasn't arrived | T+10, no arrival | coach name and phone, class, time, whether they had confirmed | — | ✅ |
| **F5** | Session needs cover | no coach found, or cover offer unclaimed | class, day + time, why no coach fits | Open calendar | ⚠️ fires before coaches are asked |
| **F6** | Coach reported a problem | coach flags a session | session, coach, what they said | — | ⚠️ omits the note |
| **F7** | Today's close | 21:00, only if there is something to say | classes run vs scheduled; attendance; **money in, with names**; exceptions (no-shows, missed arrivals); new members and trials | Open dashboard | ⚠️ counts only |
| **F8** | This week | Sunday evening | revenue; joins vs cancellations; **families at risk**; classes over/under capacity; trial conversion; coach reliability; assessment backlog | Open dashboard | 🆕 |
| **F9** | *(in-app feed only)* | every routine event | full detail, searchable, never pushed | — | ✅ |

**At-risk families (in F8)** are the highest-value line in the plan: a player
with two consecutive no-shows, or an active member with nothing booked in 14
days. Named, with the reason.

**Excluded deliberately.** Counts of routine events — "2 WhatsApp links · 4 new
players" identifies nobody who should do anything, and belongs in F9. Also
excluded: per-booking pings, coach confirmations (silence is the signal), and
anything the founder just did themselves.

---

## 6. Completeness review

Every need in §2 mapped to the messages that serve it. No cell is empty.

| Client need | Covered by |
| --- | --- |
| Can I use this? | C0, C1, C3 |
| What have I committed to? | C4, C5 |
| What's happening today? | C7 |
| Has anything changed? | C6, C8, C9 |
| Is my child safe and supervised? | C10 |
| Did my child attend? | C11 |
| Is my child improving? | C11, C12 |
| What am I paying, and when? | C13, C14, C15, C16 |
| What do I have left? | C17 |

| Coach need | Covered by |
| --- | --- |
| Am I on the team? | K1, K2 |
| What am I teaching, when, where? | K3, K4 |
| Who am I teaching? | K3, K4 |
| Has my schedule changed? | K7 |
| What do I owe the academy? | K6, K9 |
| What work is available? | K8 |
| Where do I stand on requests? | K10 |

| Founder need | Covered by |
| --- | --- |
| Who is waiting on me? | F1, F2 |
| Is today covered? | F1 |
| What's failing right now? | F3, F4, F5, F6 |
| What money came in? | F7, F8 |
| What money is at risk? | F1, F8 |
| Who is about to leave? | F8 |
| Is supply matching demand? | F8 |
| Is coaching quality holding? | F8 |

**Known and accepted omissions.** Coach payout summaries — no pay rate exists in
the schema, so it can't be built without a pricing decision. Player birthdays —
cheap goodwill, no information need, deliberately cut as excess. Per-booking
founder pings — the feed covers them.

---

## 7. Volume check

The plan adds messages but consolidates more than it adds.

| Recipient | Now | Planned |
| --- | --- | --- |
| Family, one child, one class/week | 2 (confirmation, reminder) | 2 (today, outcome) + ~2/month (receipt, progress) |
| Family, two children, both attending one day | 4 (2 reminders, 2 confirmations) | 1 today + 2 outcomes |
| Coach, 3 sessions in a day | 3 confirms + 3 nudges + 3 wraps | 1 brief + 3 informational + 3 wraps |
| Founder, ordinary day | 1 vacuous digest + every escalation | 1 brief + escalations + close only if notable |

---

## 8. Delivery classification

`T` = ignores mute preferences · `D` = held to 08:00 IST overnight ·
`Mute` = member can turn off · `Tmpl` = needs an approved WhatsApp template

| ID | T | D | Mute | Tmpl | Note |
| --- | --- | --- | --- | --- | --- |
| C0, C1, C3 | ✅ | ✅ | ❌ | ✅ | gate to everything else; C0 has no account yet, so a template is mandatory |
| C2 | ❌ | ✅ | ✅ | ✅ | marketing — must be mutable |
| C4, C5 | ❌ | ✅ | ❌ | ✅ | |
| C6 | ❌ | ❌ | ✅ | ✅ | it's a race — never hold |
| C7 | ❌ | ❌ | ✅ | ✅ | 08:00 is outside quiet hours anyway |
| C8 | ❌ | ⚠️ | ✅ | ❌ | defer only if the session is >48h away |
| C9 | ✅ | ❌ | ❌ | ❌ | silence strands a child |
| C10 | ❌ | ❌ | ❌ | ✅ | worthless late |
| C11 | ✅ | ❌ | ❌ | ✅ | absence is transactional; delay defeats it |
| C12 | ❌ | ✅ | ✅ | ✅ | |
| C13, C14, C16, C17 | ❌ | ✅ | ❌ | ✅ | money — not mutable |
| C15 | ✅ | ✅ | ❌ | ✅ | nobody fixes a card at 2am |
| C18 | ❌ | ✅ | ❌ | ❌ | |
| K3, K5, K8 | ❌ | ❌ | ❌ | ✅ | **must not be deferrable** — quiet hours end 08:00 and K3 fires at 07:00 |
| K4, K6 | ❌ | ❌ | ❌ | ✅ | |
| K1, K2, K7, K9, K10 | ❌ | ✅ | ❌ | K1 only | |
| F1, F8 | ❌ | ❌ | ❌ | ✅ | |
| F2 | ✅ | ❌ | ❌ | ✅ | applicant is waiting live |
| F3–F6 | ❌ | ❌ | ❌ | ❌ | expire within minutes |
| F7 | ❌ | ✅ | ❌ | ✅ | |

---

## 9. Build order

Ordered by value delivered per unit of work, with the blockers first.

**Fix before building anything**

1. **K5 and the T-30 nudge never fire.** The founder is escalated 268 times
   about arrivals that were never requested. K3 is designed to absorb a ladder
   that isn't running — fix it first or the design rests on nothing.
2. **One founder account cannot receive anything** (no phone, no WhatsApp link,
   6/6 digests failed). Link it or drop the role.
3. **Payload gaps** — C15 carries nothing, C10 loses the coach name on most
   sends, C8 carries no session. Fix at the insert sites; a template variable
   with no backing key fails silently forever.

**Then, highest value first**

4. **C11** — a parent is never told their child didn't turn up. Safety, and the
   single biggest hole in the plan.
5. **K8** — cover offers to coaches who can actually take them, instead of
   escalating to the founder to make phone calls.
6. **K3 / F1 / C7** — the three morning briefs. One build, three audiences.
7. **C1, C2, C13, C14** — the money and trial loop; the only messages that pay
   for themselves.
8. **C12, K9** — progress reporting and the assessment chase that feeds it.
9. **F7 rebuild, F8** — the founder's close and weekly review.

---

## 10. Definition of done

A notification is not finished until:

- every field it displays is present in the structured payload, asserted by a
  `tests/db/` spec;
- it is classified in §8 and added to the matching set in the worker;
- it renders correctly with **no** optional fields present;
- its information need in §2 is struck through as covered;
- if it is business-initiated, its template is provisioned and approved.
