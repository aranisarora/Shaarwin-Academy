// Runs ONCE before the Layer 1 suite: guard we're local, then rebuild the DB
// from schema.sql + seed.sql + 0009 batch data. Reset-per-suite (not per-test)
// keeps the harness fast and non-flaky — factories use unique ids so tests stay
// order-independent within the run.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertLocalSupabase } from "../../e2e/lib/env";

export default async function setup() {
  assertLocalSupabase();
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  console.log("\n[db tests] resetting local database…");
  execFileSync("node", ["scripts/test-db-reset.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
}
