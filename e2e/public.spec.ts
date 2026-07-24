import { test } from "@playwright/test";
import { auditViewport } from "./viewport";

// Public marketing/auth routes — no auth needed. Enumerated from the
// `npm run build` route table at 9648ba4.
const routes: [path: string, shot: string][] = [
  ["/", "home"],
  ["/login", "login"],
  ["/signup", "signup"],
  ["/schools", "schools"],
  ["/styleguide", "styleguide"],
];

for (const [path, shot] of routes) {
  test(`public ${path}`, async ({ page }, testInfo) => {
    await auditViewport(page, path, `${testInfo.project.name}-${shot}`);
  });
}
