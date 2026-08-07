import { test, expect } from "./fixtures";
import { createSchool, createSchoolAdmin } from "../lib/scenario";
import { instantLoginUrl } from "../../lib/school-handover";

// The handover itself: the link the founder sends, opened by a school that has
// never signed in. Everything in between — packing the credential into a URL
// fragment, reading it back in the browser, redeeming it, landing on the roster
// — is one chain, and nothing else in the suite proves the whole of it.
//
// Worth a flow rather than a unit test because two of the links in that chain
// only exist in a real browser: a fragment is not sent to the server, and the
// address bar is scrubbed by history.replaceState after the credential is read.

/** The link as the school receives it, reduced to what Playwright can open
 *  against the local server. `instantLoginUrl` builds an absolute URL on the
 *  production origin — that is its job — so the origin is dropped and the
 *  path + fragment it produced are kept exactly as they were. */
function asLocalLink(email: string, password: string): string {
  const url = new URL(instantLoginUrl(email, password));
  return `${url.pathname}${url.hash}`;
}

test("the handover link signs a school straight in", async ({ browser }) => {
  const school = await createSchool({ name: "Handover High" });
  const head = await createSchoolAdmin({ venueId: school.venueId });

  // A clean context: this is a school opening a message on a phone that has
  // never seen the app, which is the only state this link is ever used from.
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(asLocalLink(head.email, head.password));

  await expect(page).toHaveURL(/\/school(\b|\/|\?|$)/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Handover High" })).toBeVisible();

  // The credential must not survive in the URL, in this tab's history, or in a
  // back button that would put it back on screen.
  expect(page.url()).not.toContain(head.password);
  await page.goBack();
  expect(page.url()).not.toContain(head.password);

  await context.close();
});

test("a link whose password has been rotated lands on the form, not an error", async ({
  browser,
  admin,
}) => {
  const school = await createSchool({ name: "Rotated High" });
  const head = await createSchoolAdmin({ venueId: school.venueId });
  const stale = asLocalLink(head.email, head.password);

  // Exactly what the founder's "Reset the password" does, and the reason it
  // exists: cutting off someone who has left has to cut off their link too.
  await admin.auth.admin.updateUserById(head.id, { password: "Rotated!2026xyz" });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(stale);

  await expect(page).toHaveURL(/\/login\/school\?/, { timeout: 20_000 });
  await expect(page.getByText(/password has probably been changed/i)).toBeVisible();
  // Carried across so the only thing left to type is the new password.
  await expect(page.getByLabel("Email")).toHaveValue(head.email);
  // And the school is not signed in on a dead link.
  await page.goto("/school");
  await expect(page).toHaveURL(/\/login/);

  await context.close();
});

test("a link carrying rubbish falls back to the form without a word", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login/school/enter#t=not-a-real-token");

  await expect(page).toHaveURL(/\/login\/school$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "School log in" })).toBeVisible();

  await context.close();
});
