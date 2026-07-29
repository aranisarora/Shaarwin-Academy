// Playwright fixtures for role flows. A spec just asks for `clientPage`,
// `coachPage` or `founderPage` and gets a browser context pre-loaded with that
// role's @supabase/ssr session; `admin` is a service-role supabase-js client for
// seeding/asserting inside a spec. Adding a role = one seed user + one fixture.

import { test as base, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStorageState } from "../lib/auth";
import { admin as makeAdmin } from "../lib/supabase";

type Fixtures = {
  clientPage: Page;
  coachPage: Page;
  founderPage: Page;
  admin: SupabaseClient;
};

// Playwright passes the fixture callback positionally, so the second parameter
// is named `provide` rather than the conventional `use` — under the React
// plugin's rules-of-hooks a bare `use(...)` call reads as React's `use` hook
// being called outside a component.
function rolePage(role: string) {
  return async (
    { browser }: { browser: import("@playwright/test").Browser },
    provide: (p: Page) => Promise<void>
  ) => {
    const context = await browser.newContext({ storageState: await getStorageState(role) });
    const page = await context.newPage();
    await provide(page);
    await context.close();
  };
}

export const test = base.extend<Fixtures>({
  clientPage: rolePage("client"),
  coachPage: rolePage("coach"),
  founderPage: rolePage("founder"),
  admin: async ({}, provide) => {
    await provide(makeAdmin());
  },
});

export { expect };
