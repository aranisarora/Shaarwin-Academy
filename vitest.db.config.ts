import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Layer 1 of the E2E harness: DB-logic tests that call Postgres RPCs directly
// against LOCAL Supabase. No browser, no Next server. See e2e/README.md and
// docs/testing-harness-plan.md (Phase 4).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    // One DB, shared seed data — run files sequentially so suites don't race on
    // the same seeded sessions. Factories still use unique ids within a file.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
