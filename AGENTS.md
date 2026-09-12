<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Database

The canonical Postgres schema is **`supabase/schema.sql`** — a full snapshot of the `public` schema (tables, columns, types, enums, constraints, indexes, functions, RLS policies). **Read it before writing any SQL, migration, or Supabase `.from()/.select()` query** so column names, types, and enum values are exact. Do not infer the schema from migrations or app code — the live schema has drifted ahead of the migration files.

## Live access — the Supabase CLI

The **Supabase CLI** is how you reach the live database. Project ref: `jkjgdpifimvnptpxjixk` (subdomain of `NEXT_PUBLIC_SUPABASE_URL`), already linked. Read the live schema with:

```bash
supabase db dump --linked --schema public -f /tmp/live.sql
```

That is the ground truth to check `supabase/schema.sql` against. It is read-only and safe to run any time.

### Do NOT push migrations with the CLI

`supabase db push` is a deliberate no-op here — `[db.migrations] enabled = false` in `config.toml`. Do not "fix" that:

- `supabase/migrations/` has drifted behind the live DB and no longer replays from empty (0001 assumes a pre-migration base schema).
- The remote migration history shares **no versions at all** with the local files — every remote entry is a timestamp (`20260808045552`) stamped by the tooling that applied it, and `supabase migration list --linked` shows all 74 local files as unapplied. Re-enabling the push would try to replay 0001 onwards against production.

So a migration reaches production by **executing its SQL directly against the linked database** — the Studio SQL editor, or a `pg` script like `scripts/test-db-reset.mjs` pointed at the pooler. Add the file under `supabase/migrations/` for the record either way.

## Keep it in sync

Any change to the database schema **must** refresh and commit `supabase/schema.sql` in the same commit as the change:

1. Add the migration under `supabase/migrations/` and apply it to production (see above).
2. Update `supabase/schema.sql` **by hand**, in the file's existing style. It is a curated, readability-grouped snapshot — lowercase `create table`, explanatory comments, no GRANTs — not a `pg_dump`. Pasting a dump over it destroys the comments and breaks the regex parsing in `scripts/test-db-reset.mjs`.
3. Verify both directions: `npm run db:reset` must rebuild the local DB from it cleanly, and the objects you changed must match `supabase db dump --linked`. Remember to include everything the migration touched — a dropped table's trigger functions do not go with it, and a dropped policy can orphan the comment above it.
4. `git add supabase/schema.sql` and commit it alongside the change.

### Types

`lib/database.types.ts` is generated but **not** wholesale-replaceable:

```bash
npm run db:reset && supabase gen types typescript --local
```

Diff that against the committed file and port the delta. Do not overwrite — the committed file drops the `graphql_public` schema and carries a hand-maintained block of PostgREST computed fields (`classes.location_label` and friends, migration 0052) that `gen types` does not emit.

A pre-commit hook (`.githooks/pre-commit`) blocks any commit that stages a file under `supabase/migrations/` without also staging `supabase/schema.sql`. The hook is enrolled automatically by the `prepare` npm script on `npm install` (it sets `core.hooksPath` to `.githooks`).

# E2E testing harness

A local-only harness (never the live DB) proves the app's DB logic and screens. Full design + setup in `docs/testing-harness-plan.md`; runbook in `e2e/README.md`. One-time: install Docker Desktop, `npm run db:start`, `cp .env.test.local.example .env.test.local`.

- **Layer 1 — `npm run test:db`** (Vitest, `tests/db/`): calls Postgres RPCs directly against local Supabase and asserts `notifications` rows. Seconds to run, no browser.
- **Layer 2 — `npm run e2e:flows`** (Playwright, `e2e/flows/`): drives real screens for a few critical journeys. Thin by design; assertion depth lives in Layer 1.

Conventions (treat as definition-of-done, same as the schema-sync hook):

1. **Any change to a Postgres function or migration** must run `npm run test:db` and update the affected `tests/db/` specs in the same commit. A failing Layer-1 test is a real signal, not rot.
2. **A new user-facing flow that queues notifications** ships with at least one `tests/db/` spec; a new screen in a critical journey extends or adds one `e2e/flows/` spec. Scenario factories (`e2e/lib/scenario.ts`) + role fixtures make the marginal cost small.
3. **A new role** is a config change: add one seed user + one `getStorageState(role)`/fixture line — no harness code.
