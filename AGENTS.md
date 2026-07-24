<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Database

The canonical Postgres schema is **`supabase/schema.sql`** — a full snapshot of the `public` schema (tables, columns, types, enums, constraints, indexes, functions, RLS policies). **Read it before writing any SQL, migration, or Supabase `.from()/.select()` query** so column names, types, and enum values are exact. Do not infer the schema from migrations or app code — the live schema has drifted ahead of the migration files.

## Live access & regeneration — Supabase MCP

The **Supabase MCP server** is the source of truth for the live database. Use it to inspect the schema on demand (`list_tables`, `execute_sql` against `pg_catalog`) and to apply changes (`apply_migration`). Project ref: `jkjgdpifimvnptpxjixk` (subdomain of `NEXT_PUBLIC_SUPABASE_URL`).

`supabase/schema.sql` is regenerated **via the MCP** (query the catalog for tables, constraints, indexes, functions, policies and assemble the file) — there is no CLI dump step. When Claude has MCP access, ask it to refresh the file after a schema change.

## Keep it in sync

Any change to the database schema **must** refresh and commit `supabase/schema.sql` in the same commit as the change:

1. Apply the migration (via MCP `apply_migration`, or add it under `supabase/migrations/`).
2. Regenerate `supabase/schema.sql` from the live DB via the MCP.
3. `git add supabase/schema.sql` and commit it alongside the change.

A pre-commit hook (`.githooks/pre-commit`) blocks any commit that stages a file under `supabase/migrations/` without also staging `supabase/schema.sql`. The hook is enrolled automatically by the `prepare` npm script on `npm install` (it sets `core.hooksPath` to `.githooks`).

# E2E testing harness

A local-only harness (never the live DB) proves the app's DB logic and screens. Full design + setup in `docs/testing-harness-plan.md`; runbook in `e2e/README.md`. One-time: install Docker Desktop, `npm run db:start`, `cp .env.test.local.example .env.test.local`.

- **Layer 1 — `npm run test:db`** (Vitest, `tests/db/`): calls Postgres RPCs directly against local Supabase and asserts `notifications` rows. Seconds to run, no browser.
- **Layer 2 — `npm run e2e:flows`** (Playwright, `e2e/flows/`): drives real screens for a few critical journeys. Thin by design; assertion depth lives in Layer 1.

Conventions (treat as definition-of-done, same as the schema-sync hook):

1. **Any change to a Postgres function or migration** must run `npm run test:db` and update the affected `tests/db/` specs in the same commit. A failing Layer-1 test is a real signal, not rot.
2. **A new user-facing flow that queues notifications** ships with at least one `tests/db/` spec; a new screen in a critical journey extends or adds one `e2e/flows/` spec. Scenario factories (`e2e/lib/scenario.ts`) + role fixtures make the marginal cost small.
3. **A new role** is a config change: add one seed user + one `getStorageState(role)`/fixture line — no harness code.
