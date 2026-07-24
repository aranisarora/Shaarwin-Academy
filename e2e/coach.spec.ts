import fs from "node:fs";
import { test } from "@playwright/test";
import { auditViewport } from "./viewport";

// Authenticated coach surfaces — see the note in client.spec.ts on captured
// storage state and clean skipping.
const state = "e2e/.auth/coach.json";
test.use({ storageState: state });
test.skip(!fs.existsSync(state), "capture auth state first — see e2e/README.md");

const routes: [path: string, shot: string][] = [
  ["/coach", "coach-home"],
  ["/coach/players", "coach-players"],
];

for (const [path, shot] of routes) {
  test(`coach ${path}`, async ({ page }, testInfo) => {
    await auditViewport(page, path, `${testInfo.project.name}-${shot}`);
  });
}

// The session sheet route is dynamic — discover a real id from the calendar
// rather than hardcoding one. Skips when there are no upcoming sessions.
test("coach session sheet", async ({ page }, testInfo) => {
  await page.goto("/coach/calendar");
  await page.waitForLoadState("networkidle");
  const href = await page
    .locator('a[href*="/coach/session/"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  test.skip(!href, "no upcoming session to open");
  await auditViewport(page, href!, `${testInfo.project.name}-coach-session`);
});
