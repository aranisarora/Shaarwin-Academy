import { expect, type Page } from "@playwright/test";

export async function auditViewport(page: Page, path: string, shot: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollWidth - window.innerWidth
  );
  expect(overflow, `${path} scrolls horizontally`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `test-results/screens/${shot}.png`, fullPage: true });
}
