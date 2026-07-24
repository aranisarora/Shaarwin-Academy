import fs from "node:fs";
import { test } from "@playwright/test";
import { auditViewport } from "./viewport";

// Authenticated admin surfaces — see the note in client.spec.ts on captured
// storage state and clean skipping.
const state = "e2e/.auth/admin.json";
test.use({ storageState: state });
test.skip(!fs.existsSync(state), "capture auth state first — see e2e/README.md");

const routes: [path: string, shot: string][] = [
  ["/admin", "admin-home"],
  ["/admin/schedule", "admin-schedule"],
  ["/admin/weekly", "admin-weekly"],
  ["/admin/players", "admin-players"],
];

for (const [path, shot] of routes) {
  test(`admin ${path}`, async ({ page }, testInfo) => {
    await auditViewport(page, path, `${testInfo.project.name}-${shot}`);
  });
}
