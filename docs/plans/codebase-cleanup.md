# Codebase cleanup plan — dead code, redundant fallbacks, duplication

**Status:** not started. Written 2026-07-29.
**Audience:** implementing model. Every claim was verified on 2026-07-29 by static read,
`grep`, and a `knip@6.29` run unless marked **Verify**. Absorbs and supersedes
`docs/reuse-audit.md` (now deleted); original evidence line numbers preserved.

**Goal:** an optimum codebase — no dead code, no redundant fallbacks, one implementation
per concern. Not in scope: performance (see `navigation-performance.md`), features.

**Ground rules**

- Work in small commits, one phase-item per commit where practical, so a bad deletion
  bisects cleanly.
- After each phase: `npm run lint && npx tsc --noEmit && npm run test`. Phases touching
  booking/notification paths also run `npm run test:db` (needs Docker + `npm run db:start`).
- Nothing here changes a Postgres function. If you end up changing one anyway, `AGENTS.md`
  rules apply (test:db + schema.sql sync in the same commit).

---

## Phase 1 — Delete dead code

All findings cross-checked with `grep` over `app/`, `components/`, `lib/`. Server actions
are only ever referenced by import (or same-file `<form action={...}>`) — both checked.

### 1.1 Unused dependency: `resend`

Zero references to `resend` anywhere in `app/`, `lib/`, `components/`, `scripts/`
(case-insensitive). Remove from `package.json` dependencies, run `npm install`, commit the
lockfile.

### 1.2 Dead server actions (exported, zero callers)

| Action | Location | Note |
| --- | --- | --- |
| `bookSession` + type `BookResult` | `app/app/book/actions.ts:92`, `:6` | Booking now goes through RPCs used elsewhere in the file |
| `requestPrivateClass` + type `PrivateResult` | `app/app/book/private/actions.ts:141`, `:78` | Superseded by `create_private_series` path in `PrivateWizard` |
| `deleteStudentNote` | `app/coach/players/[playerId]/actions.ts:34` | No UI calls it |
| `promoteToCoach` | `app/admin/coaches/actions.ts:22` | Thin wrapper; the core in `lib/admin-ops-coaches.ts` stays (WhatsApp tools use it) |
| `createOneOffSession` | `app/admin/schedule/actions.ts:197` | Same shape: wrapper dead, core in `lib/admin-ops-calendar.ts` stays |

**Verify before each deletion:** `grep -rn "<name>" app components lib` shows only the
definition site (and, for the wrappers, the unrelated core function of the same name in
`lib/`). If a type is exported only for the deleted action's signature, delete it too.

**Do not delete the `lib/admin-ops-*` cores.** They are shared with the WhatsApp bot —
that is the best-factored pattern in the codebase.

### 1.3 Dead exports (un-export or delete the code)

From knip, individually re-checked. "Un-export" = keep the code if used in-file, drop the
`export` keyword; delete outright if nothing in-file uses it either.

- `components/app/AddressDisplay.tsx:50` `formatAddress`
- `components/app/AddressSearch.tsx:37` `featureToGeocodeHit`
- `components/app/admin-calendar-types.ts:7` `sessionTimeStatus` + type `SessionTimeStatus`
- `components/app/ArrivalActions.tsx:19` `resolveDistance`
- `lib/address-format.ts:32` `formatAddressLine`
- `lib/coverage.ts:6,:9` `BENGALURU`, `BENGALURU_RADIUS_KM` (used in-file by
  `isWithinBengaluru` — un-export only)
- `lib/vertex.ts:14` `serviceAccount`
- `lib/whatsapp/identity.ts:24` `syntheticEmailFor`
- `lib/whatsapp/interactive.ts:21` `WA_BUTTON`
- Unused exported types: `ScheduleSession` (`CoachScheduleDays.tsx:15`), `VenueClassInfo`
  (`NearbyVenues.tsx:10`), `FilterOption` (`ui/FilterBar.tsx:14`), `BookingStatus`,
  `SubscriptionStatus` (`lib/admin-ops-types.ts:16–17`), `RazorpayCheckoutResponse`,
  `RazorpayCheckoutOptions` (`lib/razorpay-checkout.ts:5,:12`), `StudentStats`
  (`lib/student-insights.ts:14`), `GuestReason` (`lib/whatsapp/identity.ts:38`),
  `ToolInput` (`lib/whatsapp/tools/types.ts:24`)

**Leave alone (knip false positives — do NOT delete):**

- `lib/database.types.ts` helper types (`Tables`, `TablesInsert`, `TablesUpdate`, `Enums`,
  `CompositeTypes`, `Constants`) — generated file; will be regenerated verbatim.
- `e2e/lib/*` unused helpers (`expectNoNotification`, `createWeeklySlot`, `bookSession`,
  etc.) — deliberate harness API surface per `docs/testing-harness-plan.md`.
- "Unused files" flagged by knip that are entry points knip can't see:
  `playwright.flows.config.ts` + `e2e/flows/global.setup.ts` (used by `npm run e2e:flows`),
  `vitest.db.config.ts` + `tests/db/*` (used by `npm run test:db`),
  `supabase/functions/notify/index.ts` (Deno edge function, separate module graph),
  `scripts/*.mjs` (manual/one-off scripts run by hand or npm scripts).

### 1.4 `app/styleguide/page.tsx` — dev-only page shipped to production

A design-token/styleguide page publicly routable in prod. Either delete it, or gate it:
`if (process.env.NODE_ENV === "production") notFound();`. Recommendation: gate — it's
useful during design work. One-line change either way.

### 1.5 Optional guard: keep knip

Add `knip` as a devDependency with a `knip.json` ignoring the false positives above
(`entry` for the playwright/vitest configs and `scripts/**`, `ignore` for
`supabase/functions/**` and `lib/database.types.ts`), plus a `"knip": "knip"` npm script.
Cheap regression guard; skip if you'd rather not carry the config.

---

## Phase 2 — Remove redundant fallbacks and leftovers

### 2.1 `requireUser`'s belt-and-braces profile provisioning (`lib/auth.ts:57–77`)

`requireUser` re-implements what the DB already does: `public.handle_new_user()`
(`supabase/schema.sql:1947`) inserts the `profiles` row **and** the `players` row for
every new auth user (client branch at schema.sql:1995–2001), with the coach-invite branch
handled too. The app-layer fallback is a second implementation that can drift (it already
has: it inserts `approval_status`-less profiles, relying on the column default).

**Verify first (the one genuine unknown):** the trigger *function* is in the schema
snapshot, but the `CREATE TRIGGER ... ON auth.users` lives in the `auth` schema, outside
the snapshot. Via Supabase MCP run:
`select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and tgname not like 'RI_%';`
and confirm a trigger invoking `handle_new_user` exists and is enabled.

**Then:** delete the `if (!profile) { ... }` block; replace with a hard failure
(`redirect("/login")` or throw) since a signed-in user with no profile now indicates a
real bug, not a provisioning race. Keeping silent auto-provisioning in two places is
exactly the redundancy this plan exists to remove.

**If the trigger turns out to be missing on live:** fix that (create the trigger via
migration, schema-sync per `AGENTS.md`) rather than keeping the app-layer copy.

### 2.2 `stripe_customer_id` — Stripe is gone, the field remains

Billing is Razorpay (`lib/razorpay.ts` explicitly notes it replaced `lib/stripe.ts`). The
only live reference is the `Profile` type (`lib/auth.ts:30`); no code reads or writes it.

- Remove `stripe_customer_id` from the `Profile` type.
- DB column: leave in place for now (it may hold historical customer ids; dropping is a
  migration + schema-sync + data decision for the owner). Note it in the commit message as
  intentionally retained.

### 2.3 Minor fallbacks — keep

`proxy.ts:66–67` (`profile?.role ?? "client"`, `roleHome[role] ?? "/app"`) are cheap
fail-safe defaults on the auth boundary, not duplicate implementations. Keep.

---

## Phase 3 — Correctness fixes (from the reuse audit)

Ordered by severity. These are bugs wearing a "duplication" costume.

### 3.1 Profile editor saves phone unnormalized → silently breaks WhatsApp identity

`app/app/profile/actions.ts:28` writes `phone: input.phone.trim() || null` — the only
phone write path calling neither normalizer in `lib/whatsapp/phone.ts`. WhatsApp inbound
matching (`lib/whatsapp/identity.ts:55`) compares the normalized inbound number against
`profiles.phone`; a profile-edited `"98123 45678"` never matches `"+919812345678"`, so the
user silently drops to guest mode — and a profile edit can *degrade a working account*
that onboarding had stored correctly.

- **Fix:** `normalizePhoneInput`, friendly error on null (mirror
  `app/app/onboarding/actions.ts:123`). Consider the uniqueness pre-check that
  `updateClientCore` (`lib/admin-ops-clients.ts:22–33`) does.
- **Pin it:** add a `tests/db/` identity-resolution spec per `AGENTS.md`.

### 3.2 Admin paths use the permissive normalizer on typed input

Six sites run founder-typed input through `normalizePhone` (Twilio-E.164 semantics)
instead of `normalizePhoneInput` (form semantics): `lib/admin-ops-clients.ts:17, :75,
:120`; `lib/admin-ops-coaches.ts:111, :142, :205`. A founder typing `9812345678` gets the
junk `+9812345678` stored with no error; for `addClientInviteCore` the invite claim
trigger then never matches. **Fix:** swap the identifier at all six sites — the existing
"That phone number doesn't look valid." error already handles the null return.
`normalizePhoneInput` delegates to `normalizePhone` for `+`/`00`-prefixed input
(phone.ts:44), so bot-sourced E.164 numbers still pass.

### 3.3 Formatters with no `timeZone` — wrong for any non-IST viewer

Five `toLocaleDateString("en-GB", …)` calls with no `timeZone` render in the device
timezone: `components/app/AvailabilityEditor.tsx:155–156`, `app/admin/page.tsx:164–165`,
`app/admin/coaches/page.tsx:89`, `components/app/ClientManager.tsx:411`, and — worst —
`components/app/PlayerManager.tsx:238` (**player date of birth**: if `date_of_birth` is a
bare `date`, `new Date("2015-03-01")` parses as UTC midnight and negative-offset viewers
see the previous day). **Fix:** route through `lib/academy-time.ts` (`formatDate` /
`formatDateFull`; check `formatWallDay` at academy-time.ts:189 for the DOB case — never
construct a `Date` from a bare `YYYY-MM-DD`).

### 3.4 Client LTV renders in pounds

`components/app/ClientManager.tsx:416`: `paid £{(selected.ltvPence / 100).toFixed(0)}` —
a `£` on paise. **Fix:** `formatPrice(selected.ltvPence)` from `lib/format.ts`.

---

## Phase 4 — Collapse duplication to the canonical module

The pattern throughout: a canonical module exists, is widely imported, and is bypassed —
sometimes on the line below its own import. Two modules' header comments record they were
created to end exactly the duplication that grew back.

### 4.1 Date/time formatting → `lib/academy-time.ts` (~20 IST-locked formatters, 25 importers)

- **Exact duplicates, delete + import:** `components/app/ScheduleList.tsx:24–32` (`fmt`
  ≡ `formatSessionDate`, academy-time.ts:107–113) and
  `components/app/SessionArrival.tsx:22–28` (`fmtClock` ≡ `formatClock`,
  academy-time.ts:94, 129–132). Both files already import from `academy-time`.
- **Local formatter sets, migrate mechanically** (import where an equivalent exists;
  promote genuinely new shapes *into* `academy-time`, then import):
  `components/app/SlotPicker.tsx` (10 formatters + its own `IST` const),
  `PrivateWizard.tsx:37,50,61,70`, `BookBrowser.tsx:25,38`, `StudentInsights.tsx:15,27`,
  `StudentNotes.tsx:16`, `RescheduleSheet.tsx:21`, `NotificationsList.tsx:52`,
  `admin-calendar-types.ts:129–172`, `AdminAddSheet.tsx:79`, `app/coach/page.tsx:18,27`,
  `app/coach/session/[id]/page.tsx:106,113`, `app/admin/schedule/page.tsx:247`,
  `app/admin/schedule/actions.ts:469`, `app/admin/page.tsx:138`,
  `app/app/players/[playerId]/page.tsx:14`, `lib/admin-ops-calendar.ts:10`,
  `lib/billing.ts:175`, `lib/whatsapp/interactive.ts:482`,
  `lib/whatsapp/tools/types.ts:45`.
- **Exempt:** `supabase/functions/notify/index.ts` — Deno module graph, cannot import
  `lib/`; its local formatters are legitimate.

### 4.2 Currency → `lib/format.ts` `formatPrice`

- `app/admin/page.tsx:213` hand-rolls `₹{(revenue / 100).toLocaleString("en-IN")}` →
  `formatPrice(revenue)`.
- `lib/whatsapp/tools/types.ts:56–62` maintains an acknowledged copy
  (`formatPricePence`, "Mirrors lib/data.ts formatPrice"). `lib/format.ts` is
  dependency-free and `lib/data.ts:183` merely re-exports it, so the bot can almost
  certainly import `@/lib/format` directly. **Verify** the import doesn't drag server-only
  modules into the bot graph; then delete the copy.

### 4.3 Two-tap destructive confirm → `components/ui/ConfirmAction.tsx`

Four re-implementations of the armed → prompt → Keep/confirm pattern:
`AdminClassSheet.tsx:79,372–402` (`deleteArmed`), `SessionRoster.tsx:44,295–340`
(`cantArmed`), `ProfileEditor.tsx:50,134–173` (`removeArmed`, per-row — one
`ConfirmAction` instance per row works, the string state disappears),
`ManageBillingButton.tsx:23,38–68` (`confirming` — check its button layout fits the
component before forcing it). `ProfileEditor.tsx:48–49` even restates ConfirmAction's own
justification in a comment.

### 4.4 Phone field → extract `components/app/PhoneField.tsx`

Three hand-rolled phone inputs: `onboarding/PhoneStep.tsx:58–68` and
`app/app/pending/PendingFlow.tsx:136–143` agree (label "Phone (with country code)",
`type="tel"`, `autoComplete="tel"`, placeholder `+91 98123 45678`);
`ProfileEditor.tsx:61–66` has drifted — no autocomplete, no placeholder, and no
"with country code" hint, the copy that prevents 3.1/3.2's bad input. Extract one wrapper
around `ui/Input` with the agreed props; use it in all three. Server-side normalization
stays regardless.

### 4.5 Coach tab icons

`components/app/CoachShell.tsx:4–8` uses Unicode glyphs (`▦ ◎ ≡`) where Admin/Client
shells use `components/ui/icons.tsx` (`SessionArrival.tsx:8` states the house rule: "No
emojis — icons + design tokens only"). `icons.tsx` already exports `CalendarIcon`,
`PeopleIcon`, `DotsIcon` — the exact three needed. ~Three-line change.

---

## Phase 5 — Primitives and guards (lowest priority)

- **`ui/Switch`:** `ProfileEditor.tsx:86–100` and `PrivateWizard.tsx:432–440` each
  hand-style a `role="switch"` toggle. Two callers is the extraction threshold.
- **`ui/Checkbox` / `ui/Radio` / `ui/DateInput`:** raw styled `<input>`s in
  `AdminAddSheet` (:585 date, :684/:694 radio, :811 checkbox), `AdminCalendarNav:111`,
  `AdminClassSheet:302`, `AdminSessionSheet` (:296/:320 radio, :472/:585 checkbox),
  `ClientManager:290`, `SkillsManager:131,:222`. Extract Checkbox/Radio first (most
  instances). A `DateInput` should mirror `TimeSelect12h.tsx`'s reasoning (`<input
  type="date">` follows the OS locale — same bug `TimeSelect12h` exists to fix). Only
  worth doing while touching those files anyway.
- **Lint guard:** once 4.1 is done, add an ESLint `no-restricted-syntax` rule banning
  `new Intl.DateTimeFormat` outside `lib/academy-time.ts` and `supabase/functions/**` —
  this duplication has regrown once already; make a third time impossible.

---

## What is genuinely fine — do not "improve"

- **Address stack** — `lib/address.ts`, `lib/address-format.ts`,
  `AddressForm|AddressSearch|AddressDisplay`, `lib/whatsapp/geocode.ts`. One
  implementation shared across roles and the bot.
- **Shells** — `StudioShell`/`StageShell`/`StageHeader` with Admin/Coach/Client as thin
  tab-config wrappers (4.5 is a config nit, not structure).
- **`lib/admin-ops-*.ts` core pattern** — deliberately shared between admin server
  actions and WhatsApp tools, RLS as the boundary. 3.2 is a wrong function call *inside*
  it, not a failure of the pattern.
- **`ui/Input`** (21 importers), **`lib/academy-time.ts` itself** (25 importers),
  **`lib/venue-display.ts`** (`makeVenueResolver`).
- **Dependencies** — after 1.1 the runtime dependency list is 6 packages, all load-bearing.
  `mapbox-gl` is correctly lazy-loaded (keep it that way).

## Suggested commit order

1. Phase 1 (dead code) — one commit per subsection.
2. Phase 2 (fallbacks) — 2.1 only after its trigger verification.
3. Phase 3 in order 3.1 → 3.2 → 3.3 → 3.4 (severity).
4. Phase 4: 4.1 exact-duplicates first, then 4.4, 4.5, then the 4.1 long tail, 4.3, 4.2.
5. Phase 5 opportunistically.
