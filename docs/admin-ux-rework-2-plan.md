# Admin UX rework, round 2 — the founder's front door

Status: planned, not implemented. Written against commit `055d5bf` on `main`.
Follows `docs/admin-ux-rework-plan.md` (round 1, shipped in `b17dff0`/`eb9a375`/`055d5bf`).

North star (unchanged, sharpened): the founder should never need anything
explained. Round 1 made the *screens* self-explanatory (one card language,
plain copy, cross-links). Round 2 makes the *app* self-explanatory: it should
open on his day, every alert should land him on the exact thing to fix, and
the navigation should read like his mental model (daily loop → people → setup)
instead of a flat list of nine database tables.

## What round 1 delivered vs deferred (assessment)

Shipped and good: venue-name resolution (`lib/venue-display.ts`), shared
`ClassCard`, weekly-panel parity (regulars + venue + view-as-coach),
`?class=`/`?session=` deep-open cross-links, jargon sweep, "Add another like
this", danger-zone disclosure.

Carried into this plan (deliberately deferred in round 1):
- **3b** — the WhatsApp-suffix feedback audit (now Part 3, it's the trust model).
- **3d** — sticky Save + filter chips + thumb audit (now Part 5, needs a phone).
- **2b** — extracting the five shared sheet sections. *Dropped, not carried*:
  the user-facing parity shipped inline; extract only if a third consumer
  appears. Don't do refactors the founder can't see.

New in round 2: Parts 1, 2, 4, 6 — front door, navigation, colour contract,
detail sweep. These come from the sharpened brief: structure and flow, not
just copy.

## Read first (non-negotiable)

- `AGENTS.md` — this Next.js has breaking changes vs. training data; copy
  in-repo patterns. `supabase/schema.sql` before any query change.
- Key files: `app/admin/page.tsx`, `components/app/AdminShell.tsx`,
  `components/shells/StudioShell.tsx`, `components/ui/BottomTabBar.tsx`,
  `app/admin/more/page.tsx`, `app/admin/schedule/actions.ts`,
  `components/app/ActionResult.tsx`, `app/globals.css`.

---

## Part 1 — The front door: "Today", not a dashboard (highest impact)

**Problem.** The app opens on `/admin` — tab labelled "Inbox", page titled
"Dashboard", content led by four KPI cards (Active members, Revenue, Classes
this week, Needs you). That's investor-brain. His morning question is "what's
on today and does anything need me?" — he currently has to tap through to
Schedule to answer it. Worse, the "Needs your attention" rows link to
*generic pages* (`/admin/schedule`, `/admin/coaches`, `/admin/players`) —
he lands on a list and has to find the item again.

**Fix — restructure `/admin` top-to-bottom:**

1. **Rename**: tab + title both become **"Today"** (kills the Inbox/Dashboard
   mismatch). Keep the route `/admin`.
2. **Section 1 — Today's classes**: the day's sessions rendered with the
   shared `ClassCard` (same query shape as `fetchWeekSessions` filtered to
   today; reuse, don't fork). Tap → `/admin/schedule?session={id}` deep-open.
   Empty state: "No classes today." This is the screen he checks courtside.
3. **Section 2 — Needs your attention** (moves up, right under today):
   every row deep-links to the *item*, not the page — this is the single
   biggest flow fix in this plan:
   - Unassigned session → `/admin/schedule?session={id}&date={date}` (the
     deep-open param from round 1 already exists — wire it here).
   - Time-off request → `/admin/coaches?coach={id}` (add the same
     server-provided deep-open param pattern to the coaches page).
   - Payment overdue → `/admin/players?view=clients&client={id}` (same).
   - Session issues already carry a `data.url` — verify those URLs use the
     new deep-open params; update the notification writers if they don't.
4. **Section 3 — the numbers, demoted**: one compact strip (not four cards)
   — "42 members · ₹58,000 this month · 31 classes this week" — linking to
   Billing. Revenue is a weekly glance, not the front door.
5. `WhatsAppAssistantCard` stays, below the fold.

**Verify**: cold-open `/admin` on a phone: today's classes visible without
scrolling; tapping an unassigned alert opens the exact session sheet with the
coach picker one tap away.

## Part 2 — Navigation reads like his mental model

**Problem.** Desktop rail: nine flat entries. Mobile: five slots (Inbox,
Schedule, Players, Coaches, More) with Weekly classes — where classes are
*created* — buried in More during exactly the migration phase when he needs
it most. Icons are abstract glyphs (`● ▦ ↻ ◉ ◎ ★ ▲ £ ≡`) that carry no
meaning — a coach in his 40s reads labels, but on the mobile bar the icon
is half the tap target's affordance.

**Fix:**

1. **Group the desktop rail** (visual grouping only, no route changes) into
   three sections with small uppercase headers, mirroring frequency of use:
   - *(no header)*: Today, Schedule, Weekly classes
   - **People**: Players, Coaches
   - **Setup**: Skills, Venues, Billing, Settings
   `StudioShell` takes `tabs` as a flat array — extend `TabItem` with an
   optional `group` label and render dividers in the rail. Client/coach
   shells pass no groups and render unchanged.
2. **Mobile bar becomes**: Today · Schedule · Weekly · Players · More.
   Coaches moves into More — his coach interactions are approvals and
   covers, and both now surface as deep-links on Today. (Reversible: it's
   one line in `AdminShell.tsx`; if he reaches for Coaches often, swap back.)
   Update the More page list accordingly (add Coaches with hint
   "Profiles, availability & time off").
3. **Real icons, no new dependency**: add `components/ui/icons.tsx` with
   ~10 inline SVG icons (24px, 1.5px stroke, `currentColor`) — home,
   calendar, repeat, people, whistle/user-check, star, map-pin, receipt,
   gear, dots. Swap `TabItem.icon` from `string` to `ReactNode`. The ivory
   aesthetic keeps working — line icons in `fg-2`/`ember` match it better
   than dingbats.

## Part 3 — Trust: every action says whether the WhatsApp went out (carried 3b)

He migrated from a world where he *watched* the message send. Round 1 shipped
the `ActionResult` component; this part finishes the audit it was built for:

1. Enumerate every admin server action in `app/admin/schedule/actions.ts`
   (and the weekly/billing/coaches action files) and tag each: notifies
   nobody / notifies booked clients / notifies the coach / both.
2. Route **all** success messages through `ActionResult`. Where a
   notification fired, the line reads "✓ Moved to 7:30 pm — everyone booked
   has been told on WhatsApp." Where nothing fired, plain "✓ Saved." He must
   never wonder whether he still has to message people manually.
3. One-line manifest comment at the top of each actions file recording the
   tag per action, so future actions inherit the discipline.

## Part 4 — Colour contract: write it down, fix the one overload

Tokens are healthy (`--ember`, `--ok`, `--err`, ivory/ink surfaces). Two
gaps:

1. **Document the semantic contract** where it's enforceable — a comment
   block in `app/globals.css` next to the tokens, plus the existing border
   legend in `ClassCard.tsx`:
   - **Red (`err`)** = *you must act now*. Unassigned, payment overdue,
     destructive confirms. Nothing else, ever.
   - **Ember** = brand + emphasis: live-now ring, private-class stripe,
     primary buttons, active tab.
   - **Green (`ok`)** = confirmed/done. **Neutral** = information.
2. **The ember overload**: ember currently means both "live right now"
   (ring) and "private class" (stripe). They can co-occur and the card is
   fine — but audit that no *badge* uses ember for two different meanings
   on the same screen. If the live badge and a private badge collide,
   the live one keeps ember; private falls back to neutral with the stripe
   carrying the meaning. (Round 1's 3e — soft absent rows — was verified
   already correct; nothing to do.)

## Part 5 — Phone-in-hand polish (carried 3d — needs eyes on a device)

Cannot be verified from code; do this pass with the dev server on a real
phone (390px). Each item is small:

1. `AdminSessionSheet` primary Save sticky at the sheet bottom (the danger
   zone is already behind "More actions"; the Save still scrolls away on
   long rosters).
2. Schedule filters: collapse to one "Filter" chip row if they wrap on
   390px.
3. Thumb audit: every sheet's primary action in the bottom half of the
   viewport; date/time inputs pre-filled and labelled with the outcome
   ("Moves this class to…").
4. Tap-count the migration flow once more: two classes back-to-back via
   "Add another like this" — target ≤ 5 taps for the second.

## Part 6 — Detail sweep (small, batch with any of the above)

1. Remaining "one-off session" strings are **client-facing** now, not admin:
   `app/app/book/private/actions.ts:197` and the legal copy at
   `app/legal/[slug]/page.tsx`. Align to "one-time session/class" for
   consistency (legal copy: keep meaning identical).
2. Empty states for the setup pages (Venues, Skills, Players) in the same
   voice as the Weekly one: one sentence saying what the page is for and
   what to do first.
3. `window.confirm` copy sweep (round 1 planned it, commit doesn't show it):
   destructive confirms name the consequence in plain English ("This cancels
   the class and messages everyone booked. Cancel it?").
4. The Schedule page's "Repeating classes are created and edited in the
   Weekly classes tab" note — round 1 said keep for one release; the
   cross-links shipped, so drop it now.

## Sequencing

1. **Part 1** (Today front door + deep-linked alerts) — highest impact,
   one PR. Part 6.4 rides along.
2. **Part 2** (rail groups, mobile bar, icons) — one PR; visual, low risk.
3. **Part 3** (notify audit) — one PR; mechanical but touches every action.
4. **Part 6.1–6.3** — ride along with whichever PR has the files open.
5. **Part 5** — final pass, phone in hand, after everything else has landed.

**Manual vs automatable**: Parts 1–4 and 6 are fully automatable from here
(code + existing deep-open params). Part 5 needs the founder's phone — or at
minimum a 390px viewport session with the dev server — before its items can
be called done. The mobile-bar swap in Part 2.2 is the only judgement call
worth a founder sanity-check after it ships: "do you miss the Coaches tab?"

## Verification

- Cold-open `/admin` (phone): today's classes above the fold; every
  needs-attention row opens the exact sheet/item in ≤ 1 tap.
- Rail shows three groups on desktop; mobile bar shows Today · Schedule ·
  Weekly · Players · More; every section still reachable in ≤ 2 taps.
- Trigger one notifying action and one silent action: the ✓ line says
  "…told on WhatsApp" only for the first.
- Grep: no user-facing "one-off session" outside git history; no red
  (`err`) usage outside act-now contexts (`grep -rn "err" components/ app/`
  spot-check against the contract).
- `tsc`, lint, tests, build green; client and coach shells pixel-unchanged
  (they share `StudioShell`).
