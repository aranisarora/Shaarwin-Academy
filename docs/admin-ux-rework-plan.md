# Admin UX rework — unified class cards + coach-first simplification

Status: planned, not implemented. Written against commit `9a59201` on `main`.
Goal: make the admin app usable by a non-tech-savvy coach in his 40s, on his phone, migrating from managing everything manually over WhatsApp. Zero learning curve is the bar: he should recognise what a screen does without being told.

## Read first (non-negotiable)

- `AGENTS.md`: this Next.js version has breaking changes vs. training data — copy in-repo patterns.
- `supabase/schema.sql` before any query change.
- Key files this plan touches: `components/app/AdminCalendar.tsx`, `components/app/AdminSessionSheet.tsx`, `components/app/AdminWeeklyClasses.tsx`, `components/app/AdminClassSheet.tsx`, `components/app/AdminAddSheet.tsx`, `app/admin/schedule/page.tsx`, `app/admin/weekly/page.tsx`, `components/app/admin-calendar-types.ts`, `components/app/ClassFields.tsx`.

## The user model (design north star)

He currently runs the academy by scrolling WhatsApp: a mental list of "Monday 6:30 at La Palazzo", tagging clients, replying to "can't make it today" messages. The app must map onto that mental model, not introduce a new one:

- **He thinks in classes, not sessions.** "The Monday evening class" is one thing to him. "Instance vs template" is our implementation detail — it must never leak into copy or navigation. The Schedule shows *this week's* classes; Weekly classes shows *the pattern*. Both must look like the same thing.
- **His daily loop is small**: check today, mark who came, handle a "can't make it", occasionally move a class or cover a coach. Everything else (billing, venues, skills, settings) is setup-once. Optimise the daily loop for one-handed phone use; setup screens can stay desktop-grade.
- **His migration job**: type in all his existing classes once, then only handle exceptions (coach time-off, client reschedules, payment issues). The Inbox already frames this correctly ("Exceptions inbox") — the class-entry step is the friction to remove.
- **Trust comes from feedback.** In WhatsApp he *sees* the message go out. Every action that notifies people must say so ("Everyone booked has been told" — this copy already exists and is exactly right; make it universal).

---

## Part 1 — Fix: venue name shows a raw address (bug, ship first)

**Where**: `app/admin/schedule/page.tsx:208-216`. Private classes resolve a display name via: exact address match → ~50m proximity match (`venueNameNear`) → `address_details?.name` → **raw address string** (first comma segment or the whole thing). Any whitespace/typo drift past 50m shows "47/1, Bengaluru…" instead of "La Palazzo".

**Fix**:
1. Normalise before the exact-match lookup (lowercase, collapse whitespace, strip trailing commas) on both sides of the `venueByAddress` Map.
2. Widen the proximity fallback slightly (Manhattan < 0.002 ≈ ~150m) — private classes at a known venue should snap to it.
3. Prefer `address_details?.name` **before** proximity (a geocoded POI name is more trustworthy than a near-miss venue).
4. Last resort stays the first comma segment, never the full address.
5. Same resolution logic must be extracted to one helper (`lib/venue-display.ts` or into `admin-calendar-types.ts`) so the card, the sheet header, and the coach app all agree. Grep for other call sites of `venueNameNear` / raw `priv.address` rendering.

**Verify**: load `/admin/schedule` against live data; every private card shows a short venue/POI name, no comma-run addresses.

## Part 2 — One class card, one class panel

Today: `AdminCalendar` cards + `AdminSessionSheet` (schedule) vs `AdminWeeklyClasses` rows + `AdminClassSheet` (weekly) are separate implementations with different layouts, different info, and different capabilities. Unify look and behaviour; keep the *scope* difference (one session vs every week) explicit.

### 2a. Shared `ClassCard` component (`components/app/ClassCard.tsx`)

Accepts a discriminated union of `SessionRow | ClassRow` (both in `admin-calendar-types.ts`). One visual grammar for both pages:

- **Line 1 (bold)**: venue name (via the Part-1 helper). Weekly page keeps its venue group headers but the card itself repeats nothing confusing — line 1 becomes the day+time there ("Mon · 6:30 – 7:30 pm").
- **Line 2**: time range (schedule) / coach name (weekly) — i.e. the *variable* fact per context.
- **Line 3**: class type — reuse the existing `classTypeLine()` logic ("Private · Rohan", "Group class", "School class"), extracted from `AdminCalendar.tsx:177`.
- **Badge row**: one `StatusBadgeGroup` used by both — In progress (ember) / Completed / ✓ Arrived (schedule); School / Paused / Ended — tap to restore (weekly). Same `Badge` tones, same order, same casing.
- **Missing info to add to the weekly card**: spots ("8 spots") and duration are on the schedule card's data but absent from weekly rows — add spots + booked-regulars count ("6 of 10 booked") so he can see at a glance which classes have room, exactly like scanning his WhatsApp groups. (`ClassRow` needs a `bookedCount` from a lightweight count query in `app/admin/weekly/page.tsx`.)
- Keep the existing border language (ember left-stripe = private, red = needs coach, ember ring = live) — it's good; document it once in the component so both pages inherit it.

### 2b. Shared panel sections

Don't force one mega-sheet; both sheets keep their identity but are assembled from the same sections:

| Section (new shared component) | Extracted from | Used by |
|---|---|---|
| `SheetClassHeader` — venue, when, spots, type badges, `AddressDisplay` | `AdminSessionSheet.tsx:328-336` | both (ClassSheet gains the venue/address header it currently lacks) |
| `CoachAssignmentSection` — picker, ranked suggestions, lock checkbox, override confirm | `AdminSessionSheet.tsx:491-542` + `AdminClassSheet.tsx:162-193` | both; a `scope` prop switches copy ("this session" / "every week") and action (`reassignSession` / `reassignClassCoach`) |
| `ClassDetailFields` (already shared) | `ClassFields.tsx:102-150` | both — **standardise the field set**: description, venue, spots, length in both sheets |
| `RosterSection` — roster + present/absent + school add-pupil | `AdminSessionSheet.tsx:371-429` | SessionSheet; ClassSheet gets a read-only "Regulars" list (who's booked on upcoming sessions) — currently the weekly panel shows *no people at all*, which is the single biggest gap for a coach who thinks in terms of "who's in that class" |
| `DangerZone` — end/cancel/delete actions with consistent warning copy | both sheets' tails | both |

**Functionality to add to `AdminClassSheet`** (parity where it makes sense):
- Regulars list (read-only roster, above).
- Venue/address header with `AddressDisplay`.
- "View this coach's app →" link (exists in SessionSheet only).

**Not** ported to ClassSheet: attendance marking and client assignment — those are per-session facts; a link "Open this week's session →" (jump to the next instance in Schedule and open its sheet) covers the "I'm here, let me mark attendance" path instead.

### 2c. Cross-linking (kills the two-tabs confusion)

- SessionSheet of a recurring class gets "This repeats every {weekday} → edit the weekly class" linking to the ClassSheet.
- ClassSheet gets "Next session: {date} →" opening that session's sheet.
- The Schedule page note "Repeating classes are created and edited in the Weekly classes tab" becomes unnecessary once the sheets link to each other; keep it for one release, then drop.

## Part 3 — Coach-first simplification (the migration story)

Ordered by impact for *his* daily reality. Each item is small; batch as convenient.

### 3a. Naming & jargon audit (cheap, do with Part 2)

Copy is already mostly plain-English ("Spots", "Everyone booked gets a message"). Remaining fixes:
- "Sessions" vs "classes": he says "class" for both. Rule: **"class" everywhere**; "session" only when disambiguating one week from the pattern — and then say "just this {weekday}" not "this session". Scope picker becomes: "Just this Monday (14 Jul)" / "Every Monday — the whole class".
- "One-off session" → "One-time class".
- "Dunning" (dashboard badge) → "Payment overdue". "Dunning grace days" (settings) → "Days to fix a failed payment".
- "Exceptions inbox" → "Needs your attention" (Inbox tab label stays "Inbox").
- Settings labels get plain phrasing + a one-line consequence hint each (e.g. "Booking cutoff — clients can't book a class that starts within this many minutes").
- Sweep `window.confirm` copy for the same tone; keep confirms for destructive actions.

### 3b. Feedback: every action visibly "sends the WhatsApp"

- Standardise the sheet-footer success message pattern into one `ActionResult` line component with a ✓ and — where a notification fired — the explicit "…has been told on WhatsApp" suffix. He must never wonder whether he still has to message people manually. Audit all admin actions in `app/admin/schedule/actions.ts` and tag which notify; wire the suffix from that.
- Attendance already does optimistic toggles — good, leave it.
- Add a lightweight inline "Saved ✓" state to the settings page inputs (they currently just spin).

### 3c. Migration mode: entering all his classes fast

No CSV importer (he doesn't have a spreadsheet — he has his head and his WhatsApp groups). Instead:
- **"Add another like this"** button on the create-class success state in `AdminAddSheet` — reopens the form pre-filled with the same venue/type/duration/spots, day and time cleared. Cuts a 12-15-tap flow to ~4 taps per additional class. This is the highest-leverage migration feature and is nearly free.
- The Weekly classes empty state becomes a mini-guide: "Add each class you run — day, time, place. We'll build the weekly schedule and handle bookings, reminders and reschedules from there."
- After his classes exist, his ongoing work is *only* the Inbox: unassigned classes, time-off approvals, payment issues, new-member approvals. Say that on the dashboard: under "Needs your attention", an empty state that reads "Nothing needs you — reminders, bookings and reschedules are handled automatically."

### 3d. Mobile ergonomics

- The bottom tab bar + sheets are already right. Verify every sheet's primary action button sits in the bottom half of the phone viewport (thumb reach); `AdminSessionSheet` is long — its primary Save should be sticky at the sheet bottom, with the danger zone collapsed behind a "More actions" disclosure.
- Date+time in the edit sheets: keep native inputs (they're the most familiar thing on a phone), but pre-fill and label with the outcome ("Moves this class to…").
- Filters on Schedule collapse to a single "Filter" chip row on mobile if they don't already fit one line.

### 3e. Colour system: document + one gap

Existing tones (ok/err/ember/neutral) are consistent. One addition: on the Schedule, **"needs a coach" red is the only red he'll see routinely** — keep red exclusively for "you must act" (unassigned, payment overdue, denied). Never use red for "Absent" *rows* in admin-facing roster views at the same intensity (absent is information, not an emergency) — soften to the existing `bg-err/10` treatment everywhere, badge stays.

## Sequencing

1. **Part 1** (venue bug) — independent, ship immediately.
2. **Part 2a+2b** (shared card + shared sections, weekly-panel parity) — the core refactor; do 2c cross-links in the same PR.
3. **Part 3a+3b** (copy + feedback) — ride along with Part 2 since the same files are open.
4. **Part 3c** ("Add another like this" + empty-state copy) — small standalone PR.
5. **Part 3d+3e** — polish pass, phone in hand.

## Verification

- `/admin/schedule`: no raw addresses on any card; private/live/unassigned border language unchanged.
- `/admin/weekly`: cards show spots + booked count; opening a class shows venue header + regulars; "Next session →" opens the correct SessionSheet; restore/end/pause still work.
- Round-trip: edit a recurring class's time via SessionSheet with "Every week" scope → Weekly card updates; edit via ClassSheet → Schedule instances move.
- Phone (390px viewport): create two classes back-to-back with "Add another like this"; count taps (target ≤ 5 for the second). Mark attendance from a coach account; every save shows the ✓ line with the WhatsApp suffix where a message fired.
- Grep check: no remaining user-facing "dunning", "one-off session", "instance", "exception" strings (`grep -ri` over `app/` + `components/`).
