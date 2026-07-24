# Testing harnesses

Two independent things live under `e2e/` — don't confuse them:

| | What it proves | Runs against | Command |
|---|---|---|---|
| **Viewport audit** (`e2e/*.spec.ts`) | Pages don't scroll sideways at phone widths; screenshots for a human fold/tap review | `localhost:3000` (your normal dev server, usually **prod** Supabase) + hand-captured auth | `npm run e2e` |
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

## Public vs. authenticated

`public.spec.ts` needs no login. The role specs (`client`, `coach`, `admin`)
audit surfaces behind auth.

**The app has no password login** — sign-in is email-OTP + OAuth only, so
Playwright can't script it. Instead each role spec loads a storage state you
capture by hand, and **skips cleanly** when the state file is missing (so a
fresh clone or CI never fails on missing auth).

## Capturing auth state (once per role)

```bash
npx playwright codegen --save-storage=e2e/.auth/client.json http://localhost:3000/login
```

Complete the email OTP by hand in the window that opens, land on the app, then
close the window — the session is written to `e2e/.auth/client.json`. Repeat
with `coach.json` and `admin.json`, signing in as each role.

Re-capture when a role spec starts failing on auth — Supabase refresh tokens
rotate, so a stored state eventually goes stale.

The `.auth/` directory and `test-results/` are gitignored — nothing here is
committed.
