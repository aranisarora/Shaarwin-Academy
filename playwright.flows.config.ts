import { defineConfig } from "@playwright/test";
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY } from "./e2e/lib/env";

// Layer 2 of the E2E harness: role flows through the REAL screens, pointed at
// LOCAL Supabase. Kept in its own config (not playwright.config.ts) so it can
// never reuse a dev server pointed at the live DB, and so `npm run e2e`
// (viewport audits) is entirely untouched. See docs/testing-harness-plan.md.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e/flows",
  fullyParallel: false,
  workers: 1, // one local DB, shared seeded world — keep flows serial + non-flaky
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [
    // Resets the DB + mints role sessions before any flow spec runs.
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "flows",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
    },
  ],
  // A dedicated Next server on 3100 wired to local Supabase — never the live DB.
  webServer: {
    command: `next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    },
  },
});
