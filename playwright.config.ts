import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // The flow harness lives in e2e/flows and runs from playwright.flows.config.ts
  // against LOCAL Supabase — keep it out of the viewport audit entirely.
  // What's left here is public.spec.ts: no login, so this runs unattended.
  testIgnore: "flows/**",
  use: { baseURL: "http://localhost:3000" },
  projects: [
    { name: "android-small", use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "iphone-14", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
