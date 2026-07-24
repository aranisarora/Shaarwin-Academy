import fs from "node:fs";
import { test } from "@playwright/test";
import { auditViewport } from "./viewport";

// Authenticated client surfaces. The app has no password login (email-OTP +
// OAuth only), so Playwright can't script a sign-in — these run against a
// storage state captured by hand (see e2e/README.md) and skip cleanly when
// no state file exists, so a fresh clone or CI never fails on missing auth.
const state = "e2e/.auth/client.json";
test.use({ storageState: state });
test.skip(!fs.existsSync(state), "capture auth state first — see e2e/README.md");

const routes: [path: string, shot: string][] = [
  ["/app", "app-home"],
  ["/app/book", "app-book"],
  ["/app/book/private", "app-book-private"],
  ["/app/schedule", "app-schedule"],
  ["/app/players", "app-players"],
  ["/app/membership", "app-membership"],
  ["/app/more", "app-more"],
];

for (const [path, shot] of routes) {
  test(`client ${path}`, async ({ page }, testInfo) => {
    await auditViewport(page, path, `${testInfo.project.name}-${shot}`);
  });
}
