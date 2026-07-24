// Shared config + safety guardrail for every test entry point (Vitest global
// setup, Playwright global setup, scenario/notification helpers).
//
// The one job that matters here: make it STRUCTURALLY IMPOSSIBLE to run the
// harness against anything but a local Supabase. If the URL host isn't
// 127.0.0.1 / localhost we throw before a single row is written — so the
// harness can never seed fake parents into the live DB or fire a real WhatsApp.

import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import { existsSync } from "node:fs";

// Tests always run from the project root (npm scripts). Avoid import.meta.url so
// this module loads identically under Vitest (ESM) and Playwright (CJS config).
const root = process.cwd();

// Load .env.test.local (local demo keys only — nothing secret). Falls back to
// the committed .example so a fresh clone still boots with sane local defaults.
const localEnv = join(root, ".env.test.local");
const exampleEnv = join(root, ".env.test.local.example");
loadEnv({ path: existsSync(localEnv) ? localEnv : exampleEnv });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Copy .env.test.local.example → .env.test.local.`);
  return v;
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
export const ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
export const DB_URL =
  process.env.TEST_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Hard-fail unless the Supabase URL points at a local host. Call this at the
 * top of every entry point before touching the database.
 */
export function assertLocalSupabase(): void {
  const host = new URL(SUPABASE_URL).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    throw new Error(
      `Refusing to run tests against non-local Supabase: ${host}. ` +
        `The E2E harness only ever runs against local Supabase in Docker.`
    );
  }
}

// Fail fast on import — no test file can accidentally skip the guard.
assertLocalSupabase();
