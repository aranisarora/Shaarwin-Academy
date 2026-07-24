import { test, expect } from "./fixtures";

// Proves the minted @supabase/ssr session actually authenticates through the
// real proxy + server components — the riskiest harness assumption. If these
// pass, every deeper flow can trust "logged in as <role>".

test("client session lands on the client home", async ({ clientPage }) => {
  await clientPage.goto("/app");
  await expect(clientPage).toHaveURL(/\/app(\b|\/|\?|$)/);
  await expect(clientPage.getByText("Your players")).toBeVisible();
});

test("coach session lands on the coach schedule", async ({ coachPage }) => {
  await coachPage.goto("/coach");
  await expect(coachPage).toHaveURL(/\/coach(\b|\/|\?|$)/);
  await expect(coachPage.getByRole("heading", { name: "Schedule" })).toBeVisible();
});

test("founder session lands on the admin ops feed", async ({ founderPage }) => {
  await founderPage.goto("/admin");
  await expect(founderPage).toHaveURL(/\/admin(\b|\/|\?|$)/);
  await expect(founderPage.getByText("Needs your attention")).toBeVisible();
});

test("wrong-role access is redirected to the caller's own home", async ({ clientPage }) => {
  await clientPage.goto("/admin");
  await expect(clientPage).toHaveURL(/\/app(\b|\/|\?|$)/);
});
