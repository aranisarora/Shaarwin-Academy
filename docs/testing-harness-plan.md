# E2E Testing Harness — Implementation Plan

**Status:** ✅ implemented (Phases 0–6). Runbook: `e2e/README.md`. Conventions: `AGENTS.md` → "E2E testing harness". Blind-user audit: `docs/blind-user-audit.md`.
**Implementer notes:** this doc is written to be executed by an agent (Opus). Follow phases in order — each phase is independently shippable and verifiable. Read `AGENTS.md` first (Next.js version has breaking changes; `supabase/schema.sql` is the canonical schema — do NOT infer schema from migrations, they have drifted behind the live DB).

## Implementation notes (what actually happened)

The plan held up; the surprises were all in getting a drifted-schema dump to rebuild cleanly on a fresh local stack. `scripts/test-db-reset.mjs` handles them and is the one place to look when the local DB won't build:

- **`schema.sql` isn't dependency-ordered.** Foreign keys (both `ALTER … ADD FOREIGN KEY` and inline `references`) are deferred and replayed last; `check_function_bodies` is off during load.
- **pgcrypto lives in the `extensions` schema** locally, so `crypt()`/`gen_salt()` need it on the search path before seeding.
- **`plpgsql.variable_conflict = use_column`** is pinned at the database level (via the local superuser) — several functions (e.g. `generate_class_sessions`) rely on it and it's superuser-only to set per-session.
- **Migrations are disabled at `supabase start`** (0001 assumes a pre-migration base and no longer replays from empty); the DB is built from `schema.sql`.
- **Venue/batch DATA lives only in migration 0009** (schema.sql is DDL-only) — 0009 is replayed after seeding, with its two superseded function redefinitions stripped.
- **GoTrue token columns** on directly-seeded `auth.users` rows are normalised from NULL to `''`, else every password sign-in 500s.
- **Cookie name is `sb-127-auth-token`** locally (from the `127.0.0.1` host); auth cookies are produced by the real `@supabase/ssr` client rather than hand-rolled.

Layer-1 items 5–6 (coach-silent escalation, quiet-hours/reminder consolidation) live in the Deno notify worker (`supabase/functions/notify`), which the plan trusts as a pipe — so they're covered at the queue level, not re-implemented as DB tests.

## Goal

A reusable, role-agnostic harness that can:

1. Become any role (client / coach / founder / future roles) on demand — no manual OTP logins, no stale storage states.
2. Seed a realistic scenario in seconds (users, children, batches, bookings) into a **local** database — never the live project.
3. Drive the real screens with Playwright.
4. Prove the correct notifications were queued to the right person at the right time — by asserting rows in the `notifications` table, not by receiving WhatsApp on a phone.
5. Cost **zero tokens per run**: tests are plain code (`npm run test:db`, `npm run e2e`). Agent involvement is only for writing/maintaining tests and for occasional manual "blind user" UX audits (see Phase 6).

## Decisions already made (do not re-litigate)

| Decision | Choice |
|---|---|
| Test database | **Local Supabase in Docker** (`supabase start`), never the live project `jkjgdpifimvnptpxjixk` |
| Test auth | **Mint sessions programmatically** in setup using seeded password users — no app-code back door |
| Notification verification depth | **Queue-level**: assert `notifications` rows (user, type, `scheduled_for`, `data` payload). The notify worker + Twilio are trusted as a pipe. (Fake-Twilio rendering tests are explicitly deferred — possible phase 2, not now.) |
| Test layers | **Two layers**: Layer 1 = Vitest tests calling Postgres RPCs directly (fast, no browser); Layer 2 = Playwright flows through real screens |

## Architecture overview

```
supabase start (Docker, local)          ← full local Postgres + Auth + PostgREST
        │
        ├── db reset script: apply supabase/schema.sql + supabase/seed.sql
        │
        ├── Layer 1: Vitest  (tests/db/*.test.ts)
        │     service-role supabase-js client → call RPC → assert rows
        │     runs in seconds, pinpoints DB-logic regressions
        │
        └── Layer 2: Playwright  (e2e/flows/*.spec.ts)
              next dev pointed at local Supabase (.env.test.local)
              global setup mints sessions per role → storage states
              specs drive screens → assert UI + assert notifications rows
```

Existing `e2e/*.spec.ts` viewport-audit specs stay as-is (they are a separate concern: screenshots + horizontal-scroll checks against manually captured auth). New flow tests live in `e2e/flows/` under a separate Playwright project so `npm run e2e` semantics don't break.

## Safety guardrail (implement first, in every layer)

Every test entry point (Vitest global setup, Playwright global setup, the seed/reset scripts) must **hard-fail unless the Supabase URL host is `127.0.0.1` or `localhost`**:

```ts
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  throw new Error(`Refusing to run tests against non-local Supabase: ${url.host}`);
}
```

This makes it structurally impossible for the harness to seed fake parents into the live database or trigger a real WhatsApp send.

---

## Phase 0 — Local Supabase up and schema loaded

**Founder manual prerequisite (one-time):** install Docker Desktop for Windows and have it running. Everything else is scripted.

1. `npx supabase init` if `supabase/config.toml` doesn't exist (it currently doesn't — only `migrations/`, `schema.sql`, `seed.sql`, `.temp/` are present). Keep generated config minimal; disable services we don't need locally if config allows (edge runtime, storage can stay default). Do **not** let `supabase init` touch or reorganize existing `supabase/` files.
2. `npx supabase start` — note the printed local URL (`http://127.0.0.1:54321`), anon key, and service_role key (these are the well-known local demo JWTs, safe to commit in `.env.test.local.example`).
3. **Schema loading — critical detail:** `supabase db reset` replays `supabase/migrations/`, but migrations have drifted behind the live schema. The local DB must be built from `supabase/schema.sql` instead. Write `scripts/test-db-reset.mjs` (or `.ps1` — repo runs on Windows, prefer a Node script for portability) that:
   - drops and recreates the `public` schema on the local DB (connection string: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`),
   - applies `supabase/schema.sql` via `psql` (bundled with the Supabase CLI container — alternatively use a Node pg client to avoid requiring psql on PATH; `npm i -D pg` is acceptable),
   - applies `supabase/seed.sql` (idempotent, fixed UUIDs, creates founder/coaches/clients with password `SeedPass!2026`).
   - Expect some iteration here: `schema.sql` may reference `auth.` functions or extensions that need enabling locally (`pgcrypto` for `crypt()`/`gen_salt()` used by seed.sql, `postgis` if present in schema). Fix forward until reset runs clean twice in a row (idempotence check).
4. Add npm scripts:
   - `"db:reset": "node scripts/test-db-reset.mjs"`
   - `"db:start": "supabase start"` (convenience)
5. Create `.env.test.local.example` with local URL + local demo keys + service role key; gitignore `.env.test.local` if it isn't already covered.

**Verify:** `npm run db:reset` twice in a row exits 0; `psql`/pg query confirms `profiles` has 6 seeded rows.

## Phase 1 — Auth: mint sessions for any role

Key fact discovered during planning: **seeded users have real passwords** (`SeedPass!2026`, bcrypt via `crypt()` in seed.sql), even though the production app UI is OTP-only. Locally, `supabase.auth.signInWithPassword()` works for them. So "minting a session" is just a password sign-in against the local stack — no admin-API token forgery needed.

1. Write `e2e/lib/auth.ts` exposing `getStorageState(role: "client" | "coach" | "founder" | string)`:
   - maps role → seeded email (client → `client-a@sharwin.example`, coach → `samir@sharwin.example`, founder → `founder@sharwin.example`); accept an explicit email too, so future roles / specific personas need no code change,
   - signs in with supabase-js `signInWithPassword` against the local URL,
   - converts the resulting session into the cookie format `@supabase/ssr` expects and writes a Playwright storage-state JSON under `e2e/.auth/local-<role>.json`.
   - **Implementation note on the cookie format:** `@supabase/ssr` stores the session in cookies named `sb-<project-ref>-auth-token` (possibly chunked `.0`, `.1`, …; value is `base64-` + base64url(JSON of the session)). For the local stack the ref part comes from the local URL. Don't guess: log in once manually through the local app UI (seeded users can't OTP locally without an inbox — use Inbucket at `http://127.0.0.1:54324` which captures local OTP emails, or temporarily verify against the format the app sets after `signInWithPassword` if a dev-only password form is easier) and copy the exact cookie name/format the running `@supabase/ssr` version produces. Match it exactly.
   - Fallback if cookie construction proves brittle: drive a real browser in global setup — open Playwright, navigate to the login page, submit email, fetch the OTP from Inbucket's REST API (`http://127.0.0.1:54324/api/v1/mailbox/...`), enter it, save storage state. This is fully automatic (no human), just slower (~5s per role). Choose whichever is more robust; hide the choice behind `getStorageState()` so specs never care.
2. Playwright global setup (`e2e/flows/global.setup.ts`): reset DB (or verify it's seeded), mint storage states for the three roles once per run.
3. Add fixtures (`e2e/flows/fixtures.ts`): `test.use`-able `clientPage`, `coachPage`, `founderPage` contexts pre-loaded with the right storage state, plus an `admin` supabase-js service-role client for seeding/asserting inside specs.

**Verify:** a smoke spec per role loads the role's home screen and sees role-specific chrome (e.g. coach sees today's sessions view, client sees book/plan surface, founder sees ops feed).

## Phase 2 — Scenario seeding library

`e2e/lib/scenario.ts` — TypeScript factory functions using the service-role client, all accepting overrides and returning created ids. Read `supabase/schema.sql` for exact column names/enums before writing each one. Core factories:

- `createClient({ children: n })` — auth user (+password) + profile + children rows; unique email per call (`test+<runid>-<n>@sharwin.example`) so tests never collide.
- `createCoach({ availability })`
- `createBatchSession({ venue, startsAt, coach })` — prefer reusing seeded venues/batches from `0009` (already referenced by seed.sql) over creating new venues.
- `bookSession({ clientId, sessionId, childId })` — call the same RPC the app calls (find it in `schema.sql` / app code, e.g. the booking RPC family from migration 0003/0012), **not** raw inserts, so tests exercise real logic.
- `timeTravel` helpers: factories accept `startsAt` offsets like `hoursFromNow(2)` — scheduled notifications are then asserted by their `scheduled_for` value rather than by waiting.

Cleanup strategy: **reset-per-suite, not per-test.** `npm run db:reset` before a suite; within a suite, factories use unique ids so tests are order-independent. Do not build per-test teardown — it's the main source of flaky harnesses.

## Phase 3 — Notification assertion helpers

`e2e/lib/notifications.ts`:

```ts
await expectNotification(admin, {
  userId,                 // right person
  type: "session_reminder", // right type — read exact type strings from schema.sql functions
  scheduledFor: { near: sessionStart.minus({ hours: 2 }), toleranceMinutes: 5 }, // right time
  dataContains: { session_id }, // right payload
});
await expectNoNotification(admin, { userId, type }); // negative assertions matter as much
```

Implementation: poll the `notifications` table (service-role) with a short timeout (~5s) since some notifications are written by triggers in the same transaction (instant) and none require the notify worker to run. Also export `expectNotificationCount` to catch the historical spam-regression class (see migration `0028_fix_series_booking_notification_spam.sql` — that bug is exactly what this harness exists to catch).

Timezone care: the product runs Asia/Kolkata (migration 0007); assert `scheduled_for` in UTC with tolerance, never by local-time string formatting.

## Phase 4 — Layer 1: DB-logic tests (Vitest)

`tests/db/*.test.ts`, run with existing `vitest` (`npm run test:db` → `vitest run tests/db`). No browser, no Next server — just service-role client + factories + notification helpers against local Supabase. Target the highest-value flows first (derive the exact RPC names from `schema.sql`):

1. **Booking a batch session** → client confirmation notification queued; coach notified; reminder rows created with correct `scheduled_for`.
2. **Recurring/series booking** → exactly N notifications, not N×occurrences (regression: 0028).
3. **Cancellation ("can't make it")** → parent + coach notifications; reminders for that session deleted (schema shows `delete from notifications where status='pending'` paths).
4. **Arrival flow** (migration 0039: provenance, arrived-implies-coming, undo) → parent arrival ping queued on coach arrival; undo removes/updates correctly.
5. **Coach silent / escalation paths** → founder escalation notification.
6. **Quiet hours / consolidated reminders** (migration 0036) → reminders collapse as designed.

Each test: seed minimal scenario → call RPC as the acting user would (use a user-scoped client via `signInWithPassword` where RLS behavior matters, service-role only for seeding/asserting) → assert rows. Aim for ~15–25 focused tests, each under a second.

## Phase 5 — Layer 2: Playwright role flows

`e2e/flows/*.spec.ts`, new Playwright project in `playwright.config.ts`:

```ts
{ name: "flows", testDir: "e2e/flows", use: { storageState: /* per-fixture */ } }
```

`webServer` must start Next with local-Supabase env (`.env.test.local`) — either a dedicated port (e.g. 3100) so it never collides with a dev server pointed at prod, or an env-guarded command. **Do not reuse an existing server for flow tests** (it may be pointed at the live DB — check `reuseExistingServer` is false or port-isolated for this project).

Keep this layer thin — it proves screens wire to the RPCs, not the RPC logic itself (Layer 1 owns that). One happy-path spec per critical journey:

1. Client books a class through the real booking UI → sees confirmation → `expectNotification` for the booking.
2. Coach opens today's session, taps the arrival stepper → parent arrival ping row appears.
3. Coach "can't make it" two-step → founder/parent notifications queued.
4. Founder sees the ops feed entry produced by 2–3.
5. One auth smoke per role (from Phase 1).

Selector policy: prefer accessible roles/labels (`getByRole`, `getByLabel`); add `data-testid` to app components only where no accessible handle exists. This doubles as an accessibility nudge and keeps the "blind user" audits honest.

npm scripts: `"e2e:flows": "playwright test --project=flows"`, keep `"e2e"` running the viewport projects unchanged (exclude `e2e/flows` from the viewport projects via `testIgnore`).

## Phase 6 — Agentic "blind user" audits (documentation only, no code)

This is the token-spending layer, deliberately manual and occasional (pre-release, or after a big UX change). Add a short `docs/blind-user-audit.md` containing a reusable prompt: the agent gets local app URL + one minted role login + a goal ("you're a parent whose kid has a trial class tomorrow — figure out where and when") and **no other product context**, drives the browser (Playwright MCP / browser skill), and reports confusion points, unclear labels, and dead ends. Because the harness gives it a seeded scenario and instant login, an audit costs minutes, not hours — but it is never part of `npm test` and burns tokens only when the founder chooses to run it.

## Token-efficiency summary (the side-goal, made explicit)

- Layers 1–5 are **plain code**: after implementation, running the entire suite costs zero tokens, forever. This is the primary answer to "I don't want tests to use too many tokens."
- The cheap habit loop: `npm run test:db` after any schema/RPC change (seconds), `npm run e2e:flows` before pushing anything user-facing (a few minutes), agentic audit rarely and deliberately.
- When a test fails, the failure message names the RPC or screen — an agent asked to fix it needs far less context (and far fewer tokens) than one asked "check if anything broke."

## Keeping the harness alive (maintenance model)

The harness is layered by rot-speed, and each layer has an owner-convention:

1. **Schema drift — solved by existing convention.** The local DB is built from `supabase/schema.sql`, which the pre-commit hook already forces to stay in sync with every schema change. `npm run db:reset` after pulling always yields a current database. No extra process needed.
2. **Layer 1 tests break only when RPC behavior changes** — which is a signal, not rot. Convention to encode in `AGENTS.md` (add this line as part of Phase 4): *"Any change to a Postgres function or migration must run `npm run test:db` and update the affected `tests/db/` specs in the same commit."* An agent implementing a flow change then treats failing DB tests as part of the change's definition-of-done, the same way the schema-sync hook works today.
3. **Layer 2 is the fragile layer by design, so it stays thin.** Happy paths only; assertion depth lives in Layer 1. Selector policy (accessible roles/labels + `data-testid` fallback) survives restyling and copy tweaks — specs break only on genuine flow changes, and there are few enough specs (~5–8) that fixing them is minutes, not a rewrite.
4. **Coverage decay is the real deprecation risk** (new features shipping untested), and it's a convention problem: add to `AGENTS.md` — *"A new user-facing flow that queues notifications ships with at least one `tests/db/` spec; a new screen in a critical journey extends an existing flow spec or adds one."* Because scenario factories and role fixtures already exist, the marginal cost of a new test is small — which is what actually makes the convention stick.
5. **New roles are a config change, not a build.** `getStorageState(role)` accepts any seeded email; adding a role = one seed user + one fixture line.
6. **Quarterly cheap health check** (founder-triggered, tokens optional): run `db:reset` twice + full suite green on a fresh clone. If setup docs have drifted from reality, this catches it before the harness quietly becomes "that thing that no longer runs."

The failure mode that actually deprecates harnesses is none of the above — it's the suite going red once, staying red, and being ignored thereafter. The countermeasure is speed: Layer 1 runs in seconds, so "run it after every RPC change" is a habit with no friction, and a red suite always means something real.

## Deliverables checklist

- [x] `scripts/test-db-reset.mjs` + `db:reset`/`db:start` scripts; `.env.test.local.example`
- [x] Local-only URL guardrail in every entry point (`e2e/lib/env.ts`)
- [x] `e2e/lib/auth.ts` (mint any role), `e2e/lib/scenario.ts` (factories), `e2e/lib/notifications.ts` (assert queue)
- [x] `tests/db/` Vitest suite (booking, series/0028, cancellation, waitlist, arrival/0039, coach confirm/reassign) + `test:db` script — 12 tests
- [x] `e2e/flows/` Playwright project + fixtures + `e2e:flows` script; existing viewport audit untouched — 6 tests
- [x] `docs/blind-user-audit.md` prompt template
- [x] Update `e2e/README.md` to describe both harnesses (viewport audit vs. flows) and the one-time Docker setup

## Founder manual steps (everything else is scripted)

1. Install Docker Desktop for Windows, launch it once.
2. Copy `.env.test.local.example` → `.env.test.local` (local demo keys only — nothing secret).
3. Thereafter: `npm run db:start` once per boot, then `npm run test:db` / `npm run e2e:flows` at will.
