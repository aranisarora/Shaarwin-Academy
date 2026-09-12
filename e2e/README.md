# Testing harnesses

Two independent things live under `e2e/` — don't confuse them:

| | What it proves | Runs against | Command |
|---|---|---|---|
| **Viewport audit** (`e2e/public.spec.ts`) | The public marketing pages don't scroll sideways at phone widths | `localhost:3000` (your normal dev server) — no login needed | `npm run e2e` |
| **Viewport audit, signed in** (`e2e/flows/viewport.spec.ts`) | Every tab of every role doesn't scroll sideways at phone widths | **Local** Supabase, same as the flow harness below | `npm run e2e:flows` |
| **E2E flow harness** (`tests/db/`, `e2e/flows/`) | The app's DB logic and critical screens actually work — notifications queued to the right person at the right time | **Local** Supabase in Docker, seeded fresh; auth minted automatically | `npm run test:db`, `npm run e2e:flows` |

The flow harness never touches the live database (every entry point hard-fails against a non-local Supabase host). Full design: `docs/testing-harness-plan.md`.

---

# E2E flow harness

Two layers, layered by rot-speed:

- **Layer 1 — `npm run test:db`** (Vitest, `tests/db/`): calls Postgres RPCs directly and asserts `notifications` rows. Seconds to run, no browser. This is where assertion depth lives — run it after any schema/RPC change.
- **Layer 2 — `npm run e2e:flows`** (Playwright, `e2e/flows/`): drives the real screens for a few critical journeys, pointed at local Supabase on port 3100. Thin by design — it proves screens wire to the RPCs, not the RPC logic.

## One-time setup

1. Install **Docker Desktop for Windows** and launch it once.
2. `npm run db:start` — boots local Supabase (first run pulls images; a few minutes).
3. `cp .env.test.local.example .env.test.local` — local demo keys only, nothing secret.

Thereafter: `npm run db:start` once per boot, then `npm run test:db` / `npm run e2e:flows` at will. `npm run db:reset` rebuilds the local DB from `supabase/schema.sql` + `seed.sql` + the 0009 batch data (the layers reset automatically before each run, so you rarely call it directly).

## How it fits together

- `e2e/lib/env.ts` — loads `.env.test.local`, and the **local-only guardrail** every entry point imports.
- `e2e/lib/auth.ts` — `getStorageState(role)` mints a Playwright session by signing a seeded user in and letting `@supabase/ssr` write the cookies (no hand-rolled format). `e2e/lib/supabase.ts` — `admin()` (service role) + `asUser()` (RLS-scoped).
- `e2e/lib/scenario.ts` — factories (`createClient`, `createCoach`, `createGroupSession`, `createWeeklySlot`, `bookSession`/`bookSeries`/`cancelBooking`/`coachMarkArrival` via the real RPCs) + time-travel helpers.
- `e2e/lib/notifications.ts` — `expectNotification` / `expectNoNotification` / `expectNotificationCount`.
- `e2e/flows/fixtures.ts` — `clientPage` / `coachPage` / `founderPage` + `admin` fixtures.

## Adding coverage

- A new notifying flow ships with a `tests/db/` spec; a new critical screen extends/adds an `e2e/flows/` spec (see the conventions in `AGENTS.md`).
- A new **role** = one seed user + one line in `ROLE_EMAILS` (`e2e/lib/auth.ts`) and a fixture — no other harness change.

The escalation / quiet-hours / reminder-consolidation logic lives in the Deno notify worker (`supabase/functions/notify`), trusted as a pipe — it's out of the harness's queue-level scope.

---

# Viewport audit (Playwright)

A lightweight, Chromium-only viewport harness for the mobile audit passes. Each
spec loads a route at two phone widths (360×740 and 390×844), asserts the page
does **not** scroll horizontally, and saves a full-page screenshot under
`test-results/screens/`. The fold / tap-target review stays human — eyeball the
screenshots.

Run it:

```bash
npm run e2e
```

The dev server is started for you (`webServer` in `playwright.config.ts`) and an
already-running `localhost:3000` is reused.

## Public only

`public.spec.ts` needs no login, so `npm run e2e` runs unattended on a fresh
clone.

There used to be `admin`, `client` and `coach` viewport specs beside it. They
pointed at **prod** Supabase and loaded a storage state captured by hand with
`playwright codegen`, skipping themselves whenever that file was missing —
which, being gitignored, it was on every fresh clone and in CI. They were
removed rather than kept as three files that quietly never ran.

To audit a screen behind a login, add a spec under `e2e/flows/`: the flow
harness signs in for you against local Supabase (`e2e/lib/auth.ts`), so there
is nothing to capture by hand and nothing to keep fresh.

That is what `e2e/flows/viewport.spec.ts` is — the signed-in half of this audit,
brought back the way this section says to bring it back. It walks every tab of
the founder, coach, client and school apps at 360px and 390px, and reports the
*deepest* element sticking out past the viewport rather than just naming the
route. Two things it does deliberately:

- It **seeds** what a screen needs to be worth auditing. An empty screen cannot
  overflow, so a green tick on an empty `/admin/skills` proves only that the
  page loaded. Add a row to `seedSkills()` (or a new seeder) whenever a screen
  gets a denser worst case than the seed produces.
- It **excuses** anything inside a container that scrolls sideways on purpose —
  the filter chip row, the week strip, the slot picker. Overflow there is the
  design, and flagging it would train you to ignore the whole report.

Add the route to `ROUTES` when you add a tab. If the screen needs an id to
exist (a player, a school pupil), extend the "player and school detail screens
fit" test instead, which builds its own.

The `.auth/` directory and `test-results/` are gitignored — nothing here is
committed.
