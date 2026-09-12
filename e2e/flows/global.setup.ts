// Runs once before the "flows" Playwright project (wired as a project
// dependency in playwright.config.ts). Rebuilds the local DB and pre-mints a
// storage state per role so specs start from a known, seeded world.

import { test as setup } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { getStorageState } from "../lib/auth";
import { assertLocalSupabase } from "../lib/env";

setup("reset local db + mint role sessions", async () => {
  assertLocalSupabase();
  execFileSync("node", ["scripts/test-db-reset.mjs"], { cwd: process.cwd(), stdio: "inherit" });
  for (const role of ["client", "coach", "founder"]) {
    await getStorageState(role);
  }
});
