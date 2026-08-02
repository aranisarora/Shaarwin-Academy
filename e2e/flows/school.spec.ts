import { test, expect } from "./fixtures";
import { createSchool, addSchoolPupil, createSchoolAdmin } from "../lib/scenario";
import { getStorageState } from "../lib/auth";

// The school head's journey: sign in, see the campus roster, open a pupil, read
// the coach's notes. Thin by design — the depth of what they may and may not
// read is asserted in tests/db/school-access.test.ts.
//
// This spec builds its own school rather than leaning on a seeded one: a school
// needs a venue, an is_school class, a coach and enrolled pupils, and wiring all
// four into seed.sql would make every other spec pay for it.

test("a school head sees their campus roster and a pupil's notes", async ({
  browser,
  admin,
}) => {
  const school = await createSchool({ name: "Playwright High" });
  const pupil = await addSchoolPupil({ school, fullName: "Ravi Kumar", grade: 6 });
  const head = await createSchoolAdmin({ venueId: school.venueId });

  await admin
    .from("student_notes")
    .insert({
      player_id: pupil,
      author_id: school.coachId,
      body: "Much steadier on the forehand this term.",
    });

  // getStorageState takes an explicit email straight through, so a school needs
  // no entry in ROLE_EMAILS — it is created per-run, not seeded.
  const context = await browser.newContext({
    storageState: await getStorageState(head.email, head.password),
  });
  const page = await context.newPage();

  // The proxy sends a school account to /school, from anywhere it doesn't belong.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/school(\b|\/|\?|$)/);

  await expect(page.getByRole("heading", { name: "Playwright High" })).toBeVisible();
  await expect(page.getByText("Ravi Kumar")).toBeVisible();
  await expect(page.getByText("Grade 6")).toBeVisible();

  await page.getByText("Ravi Kumar").click();
  await expect(page).toHaveURL(new RegExp(`/school/players/${pupil}`));
  await expect(page.getByText("Much steadier on the forehand this term.")).toBeVisible();

  await context.close();
});

test("a school head cannot reach the admin app", async ({ browser }) => {
  const school = await createSchool({ name: "Locked Out High" });
  const head = await createSchoolAdmin({ venueId: school.venueId });

  const context = await browser.newContext({
    storageState: await getStorageState(head.email, head.password),
  });
  const page = await context.newPage();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/school(\b|\/|\?|$)/);

  await context.close();
});
