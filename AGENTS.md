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
- The remote migration history shares **no versions at all** with the local files — every remote entry is a timestamp (`20260808045552`) stamped by the tooling that applied it, and `supabase migration list --linked` shows every local file as unapplied. Re-enabling the push would try to replay 0001 onwards against production.

So a migration reaches production by **executing its SQL directly against the linked database**: `supabase db query --linked -f supabase/migrations/<file>.sql`, or the Studio SQL editor. Add the file under `supabase/migrations/` for the record either way.

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

# Production operations

These live in the database or on Supabase, not in the app, so no build or test shows them.

- **`notify` has no autodeploy.** A change under `supabase/functions/notify/` does nothing in production until someone runs `supabase functions deploy notify --project-ref jkjgdpifimvnptpxjixk`. Deploy in the same session as the commit, then confirm the version went up with `supabase functions list --project-ref jkjgdpifimvnptpxjixk`. Skipping it lets production drift from the repo with nothing to say so.
- **The worker's key is a Vault secret.** The `notify-worker` cron job (every minute) posts to `functions/v1/notify` with a bearer token it reads from `vault.decrypted_secrets` where `name = 'notify_worker_key'` (migration 0094). The key is not written in the cron command. Rotate it with `vault.update_secret`, not by rescheduling the job.
- **WhatsApp delivery is a setting.** `notify` reads `settings.whatsapp_enabled` (a JSON boolean, held to that by a check constraint) on every run. Production has it `false` (migration 0095): notifications go out by push only, and a row with no push to carry it is marked `failed` with `whatsapp: disabled`. Turn it back on with `update settings set value = 'true' where key = 'whatsapp_enabled';`. The local seed sets it `true`.
- **Retention runs nightly.** Two pg_cron jobs (times in GMT) stop tables growing without bound:
  - `cron-history-prune` at 22:15 deletes `cron.job_run_details` older than seven days and runs `prune_wa_inbound_seen()` (migration 0085).
  - `notifications-prune` at 22:20 runs `prune_notifications()`: it deletes notifications older than 60 days that are no longer pending, but keeps every `signup_request` and any unread `session_issue`, `private_request_parked` or `cover_offer` (migration 0092).

  The other two jobs are `private-series-nightly` at 21:40 (`generate_private_sessions(4)`) and `session-status-hourly` at five past each hour (`sweep_session_status()`). Read the live list with `select jobname, schedule, command from cron.job;`.

# E2E testing harness

A local-only harness (never the live DB) proves the app's DB logic and screens. Full design + setup in `docs/testing-harness-plan.md`; runbook in `e2e/README.md`. One-time: install Docker Desktop, `npm run db:start`, `cp .env.test.local.example .env.test.local`.

- **Layer 1 — `npm run test:db`** (Vitest, `tests/db/`): calls Postgres RPCs directly against local Supabase and asserts `notifications` rows. Seconds to run, no browser.
- **Layer 2 — `npm run e2e:flows`** (Playwright, `e2e/flows/`): drives real screens for a few critical journeys. Thin by design; assertion depth lives in Layer 1.

Conventions (treat as definition-of-done, same as the schema-sync hook):

1. **Any change to a Postgres function or migration** must run `npm run test:db` and update the affected `tests/db/` specs in the same commit. A failing Layer-1 test is a real signal, not rot.
2. **A new user-facing flow that queues notifications** ships with at least one `tests/db/` spec; a new screen in a critical journey extends or adds one `e2e/flows/` spec. Scenario factories (`e2e/lib/scenario.ts`) + role fixtures make the marginal cost small.
3. **A new role** is a config change: add one seed user + one `getStorageState(role)`/fixture line — no harness code.
