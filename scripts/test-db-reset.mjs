#!/usr/bin/env node
// Rebuild the LOCAL test database from supabase/schema.sql + supabase/seed.sql.
//
// Why not `supabase db reset`? The migrations under supabase/migrations/ have
// drifted behind the live schema (see AGENTS.md). schema.sql is the canonical
// snapshot, so the harness builds the local DB from it directly. The venue/batch
// DATA the seed relies on lives only in migration 0009 (schema.sql is DDL-only),
// so we replay 0009's data after seeding — with its two function redefinitions
// stripped, since schema.sql already holds the canonical, newer versions.
//
// Safe by construction: connects only to the local Postgres on 127.0.0.1:54322
// and hard-fails against any non-local host. It never touches the live project.
//
// Usage: node scripts/test-db-reset.mjs   (npm run db:reset)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Local Supabase Postgres. Override with TEST_DB_URL if your ports differ.
const DB_URL =
  process.env.TEST_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// ── Safety guardrail — refuse anything that isn't local ──────────────────────
{
  const host = new URL(DB_URL).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    throw new Error(
      `Refusing to reset a non-local database: ${host}. ` +
        `The test harness only ever runs against local Supabase.`
    );
  }
}

const rawSchemaSql = readFileSync(join(root, "supabase", "schema.sql"), "utf8");
const seedSql = readFileSync(join(root, "supabase", "seed.sql"), "utf8");

// Venue/batch DATA from migration 0009 (the seed's generate_class_sessions()
// call needs real group classes to enrol). Strip 0009's `create or replace
// function` redefinitions of generate_class_sessions/rank_coaches — schema.sql
// already carries the canonical, newer versions and we must not revert them.
// The DO-block anchors and INSERTs are kept.
const FUNC_REDEF = /create or replace function[\s\S]*?\bas \$\$[\s\S]*?\$\$;/gi;
const batchesSql = readFileSync(
  join(root, "supabase", "migrations", "0009_bengaluru_batches.sql"),
  "utf8"
).replace(FUNC_REDEF, "-- [harness] 0009 function redef stripped (schema.sql is canonical)");

// schema.sql is a readability-grouped dump, NOT dependency-ordered: foreign keys
// (both standalone `ALTER TABLE … ADD FOREIGN KEY` and inline `… references …`
// column clauses) frequently precede the referenced table's PRIMARY KEY / UNIQUE
// constraint. Postgres requires the referenced key to exist when a FK is created,
// so we defer every foreign key and replay them last, once all PKs / unique
// constraints / indexes are in place.
const fkStatements = [];

// 1) Standalone FK ALTERs (one-liners in the dump).
const FK_ALTER = /^ALTER TABLE .*ADD CONSTRAINT .*FOREIGN KEY .*;\s*$/gim;
for (const m of rawSchemaSql.match(FK_ALTER) || []) fkStatements.push(m.trim());
let schemaSql = rawSchemaSql.replace(FK_ALTER, "");

// 2) Inline `references public.X(col) [on delete ACTION]` column clauses. Strip
//    the clause (keep the column + trailing comma) and re-emit it as a deferred
//    ALTER, tracking which table we're inside.
const INLINE_REF =
  /\s+references\s+(\S+?)\s*\(([^)]*)\)(\s+on\s+delete\s+(cascade|set null|restrict|no action))?/i;
{
  let table = null;
  schemaSql = schemaSql
    .split("\n")
    .map((line) => {
      const create = line.match(/^create table (\S+)\s*\(/i);
      if (create) table = create[1];
      const ref = line.match(INLINE_REF);
      if (table && ref) {
        const col = line.trim().split(/\s+/)[0];
        const onDelete = ref[3] ? ` ${ref[3].trim()}` : "";
        fkStatements.push(
          `ALTER TABLE ${table} ADD FOREIGN KEY (${col}) REFERENCES ${ref[1]} (${ref[2]})${onDelete};`
        );
        return line.replace(INLINE_REF, "");
      }
      if (line.trim() === ");") table = null;
      return line;
    })
    .join("\n");
}

// PostgREST/anon/authenticated/service_role need access to every object in the
// freshly-recreated public schema. schema.sql carries RLS but no GRANTs (it's a
// public-only dump), so re-apply the standard Supabase grants here. RLS still
// governs anon/authenticated; service_role bypasses it.
const grantsSql = `
  grant usage on schema public to postgres, anon, authenticated, service_role;
  grant all on all tables in schema public to postgres, anon, authenticated, service_role;
  grant all on all routines in schema public to postgres, anon, authenticated, service_role;
  grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
  alter default privileges in schema public grant all on routines to postgres, anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
`;

// Several stored functions (e.g. generate_class_sessions) use a subquery alias
// that collides with a declared plpgsql record variable; they only resolve
// correctly under `plpgsql.variable_conflict = use_column` (how the live DB
// runs). That GUC is superuser-only to SET per-session, so we pin it as a
// database-level default once, via the local superuser (supabase_admin). New
// sessions — this reset AND PostgREST test connections — then inherit it.
async function pinVariableConflict() {
  const su = new URL(DB_URL);
  su.username = process.env.TEST_SUPERUSER || "supabase_admin";
  const admin = new Client({ connectionString: su.toString() });
  try {
    await admin.connect();
    await admin.query(
      "alter database " +
        `"${su.pathname.slice(1)}"` +
        " set plpgsql.variable_conflict = 'use_column'"
    );
  } finally {
    await admin.end().catch(() => {});
  }
}

async function main() {
  await pinVariableConflict();

  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    // One transaction so a failure leaves the DB untouched (idempotent reset).
    await client.query("begin");
    // pg_dump-style: don't validate function bodies against not-yet-created
    // objects — schema.sql orders functions alphabetically, not by dependency.
    await client.query("set check_function_bodies = off");
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
    await client.query(schemaSql);
    // FKs last: everything they reference (PKs, unique constraints/indexes) now exists.
    if (fkStatements.length) await client.query(fkStatements.join("\n"));
    await client.query(grantsSql);
    // seed.sql uses crypt()/gen_salt() from pgcrypto, which Supabase installs in
    // the `extensions` schema (not public); make sure they resolve. schema.sql
    // reset search_path to `public` while it ran.
    await client.query("set search_path = public, extensions");
    await client.query(seedSql);
    // 0009 batch data runs AFTER seed so the founder (classes.created_by) and
    // coaches (for assignment) already exist. Its final generate_class_sessions
    // call — now the canonical schema.sql version — creates + assigns sessions.
    await client.query(batchesSql);
    // seed.sql inserts auth.users directly and leaves GoTrue's token columns
    // NULL. GoTrue scans them into non-nullable Go strings, so a NULL there
    // makes every password sign-in 500 ("Database error querying schema").
    // Normalise them to '' — how a GoTrue-created user looks.
    await client.query(`
      update auth.users set
        confirmation_token         = coalesce(confirmation_token, ''),
        recovery_token             = coalesce(recovery_token, ''),
        email_change_token_new     = coalesce(email_change_token_new, ''),
        email_change_token_current = coalesce(email_change_token_current, ''),
        email_change               = coalesce(email_change, ''),
        phone_change               = coalesce(phone_change, ''),
        phone_change_token         = coalesce(phone_change_token, ''),
        reauthentication_token     = coalesce(reauthentication_token, '')
    `);
    // Seeded personas behave as active, approved users (seed.sql leaves
    // approval_status at its 'pending' default) so both harness layers see a
    // real logged-in experience, not the awaiting-approval gate.
    await client.query(`
      update profiles
         set approval_status = 'approved',
             onboarding_step = 2,
             onboarded_at    = coalesce(onboarded_at, now())
       where email like '%@sharwin.example'
    `);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }

  // Sanity check + tell PostgREST to reload its schema cache after the DDL.
  const { rows } = await client.query(`
    select
      (select count(*) from profiles)::int as profiles,
      (select count(*) from venues)::int as venues,
      (select count(*) from classes where class_type = 'group')::int as group_classes,
      (select count(*) from class_sessions where status = 'scheduled' and starts_at > now())::int as upcoming_sessions
  `);
  await client.query("notify pgrst, 'reload schema'").catch(() => {});
  await client.end();

  const c = rows[0];
  console.log(
    `✓ Local DB rebuilt — profiles: ${c.profiles}, venues: ${c.venues}, ` +
      `group classes: ${c.group_classes}, upcoming sessions: ${c.upcoming_sessions}`
  );
  if (c.profiles < 6) throw new Error(`Expected ≥6 seeded profiles, found ${c.profiles}`);
  if (c.group_classes < 1) throw new Error(`Expected group classes from 0009, found ${c.group_classes}`);
  if (c.upcoming_sessions < 1) throw new Error(`Expected upcoming sessions, found ${c.upcoming_sessions}`);
}

main().catch((err) => {
  console.error("✗ db:reset failed:\n", err.message || err);
  process.exit(1);
});
