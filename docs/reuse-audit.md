# Reuse audit — shared modules that exist but get bypassed

**Date:** 2026-07-29
**Scope:** static read of `app/`, `components/`, `lib/`. Nothing was run or edited; every
claim below is from reading source, so each item carries a **Verify** step. Treat the
severity ordering as a suggestion, not gospel — re-judge as you go.

## The shape of the problem

This is not a codebase that lacks shared modules. The address stack
(`lib/address.ts` + `AddressForm`/`AddressSearch`/`AddressDisplay` + `lib/whatsapp/geocode.ts`),
the shells (`StudioShell` → Admin/Coach/Client), `lib/admin-ops-*` (shared by the admin
server actions *and* the WhatsApp bot), and `ui/Input` (21 importers) are all genuinely
reused and well-factored.

The recurring failure is narrower and more insidious: **a canonical module exists, is
widely imported, and is bypassed anyway — sometimes in the same file, on the line below
the import.** In two cases (`lib/academy-time.ts`, `components/ui/ConfirmAction.tsx`) the
module's own header comment records that it was created to end exactly the duplication
that has since grown back.

Items are grouped by subsystem. Each has: the claim, the evidence, how to verify, and a
suggested fix.

---

## A. Phone number entry

`lib/whatsapp/phone.ts` describes itself as "the single source of truth" and exports
**two** functions for two different audiences:

- `normalizePhone(raw)` — for numbers that already carry a country code (Twilio always
  delivers E.164). Accepts anything 7–15 digits.
- `normalizePhoneInput(raw)` — for numbers **typed into a form**. A bare 10-digit Indian
  mobile gets `+91`; anything else without an explicit `+`/`00` is *rejected*.

The header comment on `normalizePhoneInput` (phone.ts:33-40) spells out why the
distinction matters: `normalizePhone("9812345678")` returns the junk E.164
`"+9812345678"` — 10 digits, so it passes the length check — which never matches the
WhatsApp inbound `+91…`, "silently forking the account on first message."

Current state of the four entry points:

| Entry point | Server path | Uses |
|---|---|---|
| Onboarding `PhoneStep` | `app/app/onboarding/actions.ts:123` | ✅ `normalizePhoneInput` |
| Pending / request-access `PendingFlow` | `app/app/pending/actions.ts:34` | ✅ `normalizePhoneInput` |
| **Profile editor** | `app/app/profile/actions.ts:28` | ❌ **no normalization at all** |
| Admin — clients | `lib/admin-ops-clients.ts:17, 75, 120` | ⚠️ `normalizePhone` |
| Admin — coaches | `lib/admin-ops-coaches.ts:111, 142, 205` | ⚠️ `normalizePhone` |

### A1 — Profile editor saves the phone raw, which can break WhatsApp identity
**Severity: high (silent, user-facing, data-corrupting)**

`app/app/profile/actions.ts:28` writes `phone: input.phone.trim() || null` — the only
phone write path in the app that calls neither normalizer.

Why it bites: `resolveIdentity` (`lib/whatsapp/identity.ts:55`) normalizes the *inbound*
number and then matches it against `profiles.phone` (the documented fallback at
identity.ts:46-48 — "the profile whose (unique) `profiles.phone` matches — auto-link it
so step 1 hits next time"). If a client saves `"98123 45678"` or `"+91 98123 45678"` from
the profile screen, the stored value no longer equals the normalized inbound
`"+919812345678"`, the fallback match fails, and the user silently drops to guest mode on
their next WhatsApp message.

Note this can *degrade an already-working account*: onboarding stores a correctly
normalized number, and a later profile edit overwrites it with an unnormalized one.

- **Verify:** confirm `profiles.phone` is unique and that no DB trigger normalizes on
  write (check `supabase/schema.sql`). Then: sign in as a client, set the phone to
  `"98123 45678"` via the profile screen, and confirm `resolveIdentity` no longer
  resolves that user. A `tests/db/` spec would pin this.
- **Fix:** call `normalizePhoneInput` and return the existing friendly error on null.
  Also consider the uniqueness pre-check that `updateClientCore`
  (`lib/admin-ops-clients.ts:22-33`) already does — the profile path has no equivalent,
  so a collision surfaces as a raw DB error caught by the generic
  `"Couldn't save."` at actions.ts:36.

### A2 — Admin paths use `normalizePhone` where `normalizePhoneInput` is correct
**Severity: medium**

Six call sites take founder-typed input and run it through the permissive normalizer:
`lib/admin-ops-clients.ts:17` (`updateClientCore`), `:75` (`addClientInviteCore`),
`:120` (`savePendingClientCore`); `lib/admin-ops-coaches.ts:111`, `:142`, `:205`.

A founder typing `9812345678` (the natural way to type an Indian mobile) gets
`+9812345678` stored — no validation error, because it passes the 7–15 digit check. For
`addClientInviteCore` this is especially quiet: the invite row is written with a phone
that the `client_invites` claim trigger will never match, so the pre-registration just
never fires and nobody finds out why.

- **Verify:** `normalizePhone("9812345678")` → `"+9812345678"` (already asserted
  indirectly by `lib/whatsapp/phone.test.ts:52-54`, which asserts
  `normalizePhoneInput` returns null for the analogous case). Then add a client via the
  admin UI with a bare 10-digit number and inspect the stored value.
- **Fix:** swap to `normalizePhoneInput` at all six sites. The existing
  `"That phone number doesn't look valid."` error already handles the null return, so
  the diff is one identifier per site. Check whether the WhatsApp bot reaches these same
  cores with Twilio-sourced (already-E.164) numbers — if so `normalizePhoneInput` still
  handles them correctly, since it delegates to `normalizePhone` for anything starting
  `+` or `00` (phone.ts:44).

### A3 — Three hand-rolled phone fields, one of which has drifted
**Severity: low (UX/consistency)**

`components/app/onboarding/PhoneStep.tsx:58-68`, `app/app/pending/PendingFlow.tsx:136-143`
and `components/app/ProfileEditor.tsx:61-66` each build the field independently.

The first two agree: `label="Phone (with country code)"`, `type="tel"`,
`autoComplete="tel"`, `placeholder="+91 98123 45678"`. ProfileEditor has only
`label="Phone"` and `type="tel"` — no `autoComplete`, no placeholder, and critically **no
"with country code" hint**, which is the one piece of copy that stops A1/A2's bad input
in the first place.

- **Verify:** read the three blocks side by side.
- **Fix:** extract `components/app/PhoneField.tsx` wrapping `ui/Input` with the agreed
  label/placeholder/autocomplete. Optionally have it run `normalizePhoneInput`
  client-side for inline validation — but keep the server-side call regardless; the
  client one is a convenience, not the guard.

---

## B. Date/time formatting — a consolidation that got undone

`lib/academy-time.ts` exports ~20 IST-locked formatters (`formatClock`, `formatSessionDate`,
`formatDay`, `formatWeeklySlot`, …). Its header at **academy-time.ts:85-89** is explicit
about both the history and the reason:

> "(the reason these formatters used to be copy-pasted into ~20 components) … Formatters
> are built once at module load rather than per call: constructing an
> `Intl.DateTimeFormat` is the expensive part, and list views format a timestamp per row."

25 files now construct `Intl.DateTimeFormat` inline again.

### B1 — Local formatters that duplicate an existing export exactly
**Severity: medium (perf + drift risk)**

Two are byte-for-byte re-creations sitting directly below an `academy-time` import:

- `components/app/ScheduleList.tsx:21` imports `nowMs` from `@/lib/academy-time`; `:24-32`
  defines `fmt` with `{weekday:"short", day:"numeric", month:"short", hour:"numeric",
  minute:"2-digit", hour12:true, timeZone:"Asia/Kolkata"}` — field-for-field the exported
  `SESSION_DATE` / `formatSessionDate` (academy-time.ts:107-113).
- `components/app/SessionArrival.tsx:15` imports `ACADEMY_TZ, nowMs`; `:22-28` defines
  `fmtClock` — identical to `formatClock` (academy-time.ts:94, 129-132).

Both also defeat the memoization: the formatter is module-level here too, so the perf hit
is small, but each is a fresh `Intl` object that the shared module already built.

- **Verify:** diff the options objects against the `const` block at academy-time.ts:91-127.
- **Fix:** delete the local function, import the equivalent.

### B2 — Files that redefine the whole formatter set without importing academy-time
**Severity: medium**

- `components/app/SlotPicker.tsx` — redeclares `const IST = "Asia/Kolkata"` (`:17`) and
  defines **10** formatters (`:21, 36, 44, 53, 63, 73, 82, 91, 99, 111`). Its own header
  comment at `:9` states the intent — "All formatting is Asia/Kolkata via Intl — never the
  device timezone" — which is exactly what `academy-time` guarantees centrally.
- `components/app/PrivateWizard.tsx:37, 50, 61, 70`
- `components/app/BookBrowser.tsx:25, 38`
- `components/app/StudentInsights.tsx:15, 27`, `StudentNotes.tsx:16`,
  `RescheduleSheet.tsx:21`, `NotificationsList.tsx:52`
- `components/app/admin-calendar-types.ts:129, 139, 152, 162, 172`
- `app/coach/page.tsx:18, 27`, `app/coach/session/[id]/page.tsx:106, 113`
- `app/admin/schedule/page.tsx:247`, `app/admin/schedule/actions.ts:469`,
  `app/admin/page.tsx:138`, `app/app/players/[playerId]/page.tsx:14`
- `components/app/AdminAddSheet.tsx:79`, `lib/admin-ops-calendar.ts:10`,
  `lib/billing.ts:175`, `lib/whatsapp/interactive.ts:482`

- **Verify:** for each, check whether an `academy-time` export already produces the same
  string. Some will be genuinely novel shapes (e.g. `SlotPicker`'s `en-CA` date key at
  `:21` — though `wallDate` at academy-time.ts:215 may already cover it) and should be
  *added* to `academy-time` rather than inlined.
- **Fix:** import where an equivalent exists; promote the genuinely new shapes into
  `academy-time` and import those.
- **Out of scope:** `supabase/functions/notify/index.ts` (Deno edge function — separate
  module graph, cannot import from `lib/`). Its local formatters at `:229, 242, 600, 604,
  686, 695, 708` are legitimate.

### B3 — Formatters with **no `timeZone`** — these are wrong, not just redundant
**Severity: high (correctness, but only visible to non-IST viewers)**

These render in the **viewer's device timezone**, not academy time:

| File:line | What it renders |
|---|---|
| `components/app/AvailabilityEditor.tsx:155-156` | time-off range start/end |
| `app/admin/page.tsx:164-165` | time-off range on the founder dashboard |
| `app/admin/coaches/page.tsx:89` | coach time-off range |
| `components/app/ClientManager.tsx:411` | client "joined" date |
| `components/app/PlayerManager.tsx:238` | **player date of birth** |

All five use `new Date(x).toLocaleDateString("en-GB", …)` with no `timeZone` option.

The DOB one (`PlayerManager.tsx:238`) is the worst: a date-only value rendered through a
timezone-shifting formatter can display the **previous day**. Worth checking whether
`date_of_birth` is a `date` or `timestamptz` in `supabase/schema.sql` — if it's a bare
`date`, `new Date("2015-03-01")` parses as UTC midnight and any negative-offset viewer
sees `28 Feb 2015`.

For the academy's actual users (all in IST, matching the server) these render correctly
today, which is why it hasn't surfaced. It breaks for anyone travelling, and for you if
you test from a non-IST machine.

- **Verify:** set your OS timezone to something like `America/Los_Angeles`, reload each
  screen, compare against the same screen in IST. The DOB case should show a day shift.
- **Fix:** route through `academy-time` (`formatDate` / `formatDateFull`). For DOB
  specifically, consider a date-only formatter that never constructs a `Date` from a bare
  `YYYY-MM-DD` — or parse it as wall-time. Check whether `formatWallDay`
  (academy-time.ts:189) is already the right tool.

### B4 — Suggested guard
Once B1–B3 are done, an ESLint `no-restricted-syntax` rule banning
`new Intl.DateTimeFormat` outside `lib/academy-time.ts` (and the `supabase/functions/`
tree) would stop this from regrowing a third time. `eslint.config.mjs` already exists.

---

## C. Currency formatting

`lib/format.ts:5` exports `formatPrice(pence)` — `Intl.NumberFormat("en-IN")`, ₹, dividing
by 100. Re-exported from `lib/data.ts:183`. Six callers.

### C1 — `ClientManager` renders client LTV in **pounds**
**Severity: medium (visible, embarrassing, trivial fix)**

`components/app/ClientManager.tsx:416`:
`· paid £{(selected.ltvPence / 100).toFixed(0)} ·`

A `£` sign on an Indian academy's paise value, in the founder's client detail panel.

- **Verify:** open a client in the admin client manager.
- **Fix:** `formatPrice(selected.ltvPence)`.

### C2 — `admin/page.tsx` hand-rolls the same formatting
**Severity: low**

`app/admin/page.tsx:213`: `₹{(revenue / 100).toLocaleString("en-IN")}` — correct output,
duplicated logic. Diverges from `formatPrice` in that it won't pick up any future change
(rounding, `maximumFractionDigits`) made centrally.

- **Fix:** `formatPrice(revenue)`.

### C3 — `lib/whatsapp/tools/types.ts` maintains an acknowledged copy
**Severity: low (may be justified — check first)**

`lib/whatsapp/tools/types.ts:56-62` defines `formatPricePence`, with the comment
*"Mirrors lib/data.ts formatPrice."* Three callers (`tools/client.ts:360, 397, 478`;
`tools/guest.ts:33`).

- **Verify:** check whether this exists to avoid pulling `lib/data.ts`'s server-only
  imports into the bot's module graph. If so it's a deliberate boundary and should stay —
  but it should import from `lib/format.ts` directly (which looks dependency-free) rather
  than re-implementing. `lib/data.ts:183` is only a re-export of `lib/format.ts`, so the
  bot can almost certainly just import `@/lib/format`.
- **Fix:** import from `@/lib/format` if the boundary allows; otherwise leave with a
  comment explaining the constraint.
- **Related:** `lib/whatsapp/tools/types.ts:45` also has a local `fmtIST` date formatter
  (see B2), and `tools/founder-admin.ts:703, 706, 712` do raw `Math.round(x / 100)` for
  `*_inr` fields — that one is arguably fine since it's producing a *number* for the LLM,
  not a display string.

---

## D. Two-tap destructive confirm

`components/ui/ConfirmAction.tsx` implements the armed → prompt → Keep/confirm pattern.
Its header (`:3-6`) states the rationale ("native `window.confirm` dialogs look broken in
a PWA and truncate copy on small screens") and its scope: *"Shared by the admin, coach and
client sheets."* Used by `ScheduleList` and `AdminSessionSheet`.

### D1 — Four independent re-implementations
**Severity: low (pure duplication, no bug)**

| File:line | Local state |
|---|---|
| `components/app/AdminClassSheet.tsx:79, 372-402` | `deleteArmed` |
| `components/app/SessionRoster.tsx:44, 295-340` | `cantArmed` |
| `components/app/ProfileEditor.tsx:50, 134-173` | `removeArmed` (per-row, keyed by player id) |
| `components/app/ManageBillingButton.tsx:23, 38-68` | `confirming` |

`ProfileEditor.tsx:48-49` even re-derives ConfirmAction's own justification in a comment:
*"a per-row two-step in place of a native confirm, which looks broken in a PWA."*

- **Verify:** compare each against `ConfirmAction`'s API (`label`, `confirmLabel`,
  `prompt`, `onConfirm`, `pending`, `variant`, `keepLabel`).
- **Fix:** the three sheet-level ones look like direct swaps. `ProfileEditor`'s is
  per-row inside a `.map`, which works fine — `ConfirmAction` holds its own `armed` state,
  so one instance per row is correct and the `removeArmed` string state disappears.
  `ManageBillingButton` may have a different button layout; check before forcing it.

---

## E. Missing UI primitives (gap, not bypass)

Unlike A–D, these have **no** shared component to bypass. Listed so the inline styling
isn't mistaken for laziness — but each is now duplicated enough to be worth extracting.

### E1 — No `ui/Switch`
`components/app/ProfileEditor.tsx:86-100` and `components/app/PrivateWizard.tsx:432-440`
each hand-style a `role="switch"` toggle (`h-7 w-12 rounded-full`, `bg-ember`/`bg-line`,
absolutely-positioned knob). `components/app/onboarding/PlayersStep.tsx:115` uses
`aria-checked` for a segmented control — related but a different control.

- **Fix:** extract `components/ui/Switch.tsx`. Two callers is the threshold where it pays.

### E2 — No `ui/Checkbox` / `ui/Radio` / `ui/DateInput`
Raw `<input>` with bespoke styling in: `AdminAddSheet.tsx:585 (date), :684, :694 (radio),
:811 (checkbox)`, `AdminCalendarNav.tsx:111 (date)`, `AdminClassSheet.tsx:302 (checkbox)`,
`AdminSessionSheet.tsx:296, :320 (radio), :472, :585 (checkbox)`,
`ClientManager.tsx:290 (checkbox)`, `CoachManager.tsx:439 (file)`,
`SkillsManager.tsx:131, :222`.

`components/ui/Input.tsx` covers text-ish inputs only (21 importers, well adopted), so
these aren't bypassing anything.

Note `components/app/TimeSelect12h.tsx` is the *good* version of this pattern — it exists
precisely because `<input type="time">` follows the OS locale (see its header at `:5`).
`<input type="date">` has the same problem and has no equivalent wrapper.

- **Fix:** lowest priority in this document. Extract `ui/Checkbox` and `ui/Radio` first
  (most instances); consider a `ui/DateInput` mirroring `TimeSelect12h`'s reasoning.

---

## F. Icon inconsistency

`components/app/CoachShell.tsx:4-8` uses Unicode glyphs for its tab icons:
`"▦"` (Schedule), `"◎"` (Players), `"≡"` (More).

`components/app/AdminShell.tsx` and `ClientShell.tsx` use components from
`components/ui/icons.tsx`. `components/app/SessionArrival.tsx:8` states the house rule
outright: *"No emojis — icons + design tokens only."*

**Severity: low (cosmetic, but it's the coach's primary navigation)**

- **Verify:** open `/coach` on a phone and compare the tab bar against `/admin`. Glyph
  rendering also varies by font/platform, so this may look worse on some devices than in
  your browser.
- **Fix:** `components/ui/icons.tsx` already exports `CalendarIcon`, `PeopleIcon`,
  `DotsIcon` — the exact three needed. Roughly a three-line change.

---

## What is genuinely fine

Recorded so this doc isn't read as "everything is duplicated":

- **Address stack** — `lib/address.ts` (structured type + Mapbox merge), `lib/address-format.ts`,
  `components/app/AddressForm|AddressSearch|AddressDisplay`, `lib/whatsapp/geocode.ts`.
  One implementation, shared across client/coach/founder and the bot.
- **Shells** — `StudioShell` / `StageShell` / `StageHeader`, with Admin/Coach/Client as
  thin tab-config wrappers. Correct factoring (F is a config-level nit, not structural).
- **`lib/admin-ops-*.ts`** — the "core" pattern deliberately shares business logic between
  the admin server actions and the WhatsApp tools, with RLS as the enforcement boundary.
  This is the best-factored part of the codebase; A2's bug is a wrong-function call
  *inside* it, not a failure of the pattern.
- **`ui/Input`** — 21 importers, near-universal adoption for text fields.
- **`lib/academy-time.ts` itself** — 25 importers. The module is good; B is about the
  files that import it and then don't use it.
- **`lib/venue-display.ts`** — `makeVenueResolver` centralises the venue-title fallback
  chain that a recent commit (`a5c0a2d`) was specifically fixing.

---

## Suggested order

1. **A1** — silent identity corruption, small diff.
2. **A2** — same subsystem, one identifier per site; do it in the same pass.
3. **B3** — the five missing-`timeZone` formatters; the DOB one especially.
4. **C1** — the `£`; one line.
5. **B1** — the two exact-duplicate formatters (delete + import).
6. **A3** — extract `PhoneField`.
7. **F** — coach tab icons.
8. **B2** — the long tail of local formatters. Mechanical; good candidate for one focused pass.
9. **D1** — four `ConfirmAction` migrations.
10. **C2, C3** — currency tidy-up.
11. **E1, E2** — new primitives; only worth it if you're touching those files anyway.
12. **B4** — the lint guard, once B is clean.

Per `AGENTS.md`: anything touching a Postgres function or migration needs
`npm run test:db` and updated `tests/db/` specs in the same commit. A1 and A2 are
app-layer only, but A1 is exactly the kind of thing a `tests/db/` identity-resolution spec
should pin — worth adding one alongside the fix. `lib/whatsapp/phone.test.ts` already
covers the normalizer semantics, so the A-series fixes need no new unit tests, only
call-site changes.
