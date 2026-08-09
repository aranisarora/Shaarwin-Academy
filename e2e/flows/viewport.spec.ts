// The mobile audit for every screen behind a login.
//
// `e2e/public.spec.ts` already does this for the marketing routes, and its
// README explains why the admin/client/coach copies of it were deleted: they
// pointed at prod Supabase and loaded a hand-captured storage state that was
// gitignored, so they skipped themselves on every fresh clone. This is that
// coverage brought back the way the README says to bring it back — through the
// flow harness, which signs each role in against LOCAL Supabase, so there is
// nothing to capture by hand and nothing to keep fresh.
//
// It asserts the same one thing `auditViewport` does — the page must not scroll
// sideways at 360px and 390px — but reports WHICH element sticks out, because
// "/admin/skills scrolls horizontally" on its own sends you hunting.

import { test, expect, type Browser, type Page } from "@playwright/test";
import { getStorageState, type StorageState } from "../lib/auth";
import { admin } from "../lib/supabase";
import { createSchool, addSchoolPupil, createSchoolAdmin } from "../lib/scenario";

const WIDTHS = [
  { w: 360, h: 740 },
  { w: 390, h: 844 },
];

/**
 * The seed ships no skills, so /admin/skills and /coach/skills would be audited
 * showing their empty state — a screen that cannot overflow because it has
 * nothing on it. That is the failure mode this whole file exists to avoid: a
 * green tick that proves the page loaded, not that it fits.
 *
 * So seed the worst row the screen can produce. Founder-side a skill row is a
 * rename field, a "Hidden" badge, Hide/Restore and Delete side by side, and
 * "Restore" is wider than "Hide" — an inactive skill with a long name is the
 * widest thing /admin/skills will ever draw.
 */
async function seedSkills() {
  const db = admin();
  const { data: cat } = await db
    .from("skill_categories")
    .insert({ name: "Technique", sort_order: 0 })
    .select("id")
    .single();
  if (!cat) throw new Error("could not seed a skill category");
  await db.from("skills").insert([
    { category_id: cat.id, name: "Forehand topspin", active: true, sort_order: 0 },
    {
      category_id: cat.id,
      name: "Backhand block under pressure",
      active: false,
      sort_order: 1,
    },
  ]);
}

/** Every screen reachable from a bottom tab or the More sheet, per role. */
const ROUTES: Record<string, string[]> = {
  founder: [
    "/admin/schedule",
    "/admin/schedule?view=timetable",
    "/admin/notifications",
    "/admin/players",
    "/admin/coaches",
    "/admin/clients",
    "/admin/skills",
    "/admin/venues",
    "/admin/schools",
    "/admin/billing",
    "/admin/settings",
    "/admin/more",
  ],
  coach: [
    "/coach",
    "/coach/players",
    "/coach/skills",
    "/coach/notifications",
    "/coach/more",
  ],
  client: [
    "/app",
    "/app/players",
    "/app/book",
    "/app/book/private",
    "/app/schedule",
    "/app/membership",
    "/app/notifications",
    "/app/profile",
    "/app/more",
  ],
};

/**
 * Elements whose right edge lands past the viewport.
 *
 * Filtered two ways, or the report is unreadable. Every ancestor of an
 * offending node is itself "wide", so only the DEEPEST offenders are kept — the
 * thing to fix is the leaf, not the six wrappers stretched by it. And anything
 * inside a scroll container that is *meant* to scroll sideways (the filter chip
 * row, the week strip) is skipped: overflow there is the feature.
 */
async function offenders(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: Element[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      let p: HTMLElement | null = el.parentElement;
      let excused = false;
      while (p && p !== document.body) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === "auto" || ov === "scroll" || ov === "hidden") {
          excused = true;
          break;
        }
        p = p.parentElement;
      }
      if (!excused) bad.push(el);
    }
    return bad
      .filter((el) => !bad.some((other) => other !== el && el.contains(other)))
      .slice(0, 8)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute("class") ?? "").slice(0, 160),
          text: (el.textContent ?? "").trim().slice(0, 60),
          overhang: Math.round(r.right - vw),
        };
      });
  });
}

/** Open `path` at `w`×`h` as `state`, screenshot it, assert it fits. */
async function auditAt(
  browser: Browser,
  state: StorageState,
  path: string,
  shot: string,
  w: number,
  h: number
) {
  const context = await browser.newContext({
    storageState: state,
    viewport: { width: w, height: h },
  });
  const page = await context.newPage();
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    // Streamed under <Suspense>, so the skeleton resolves after load.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(600);

    const scroll = await page.evaluate(
      () => document.scrollingElement!.scrollWidth - window.innerWidth
    );
    await page.screenshot({
      path: `test-results/screens/${shot}-${w}.png`,
      fullPage: true,
    });
    expect(
      scroll,
      `${path} @${w}px scrolls horizontally by ${scroll}px\n` +
        JSON.stringify(await offenders(page), null, 2)
    ).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
  }
}

const slug = (role: string, path: string) =>
  `${role}${path.replace(/[^a-z0-9]+/gi, "-")}`;

test.beforeAll(seedSkills);

for (const [role, routes] of Object.entries(ROUTES)) {
  for (const { w, h } of WIDTHS) {
    for (const path of routes) {
      test(`${role} ${path} @${w}`, async ({ browser }) => {
        await auditAt(browser, await getStorageState(role), path, slug(role, path), w, h);
      });
    }
  }
}

// ── The screens that only exist once there is a row to open ────────────────
// A player detail page carries the densest layout in the app (the stat grid,
// the skill ratings, the notes list) and none of it is reachable from a route
// table — you need an id. Same for the school role, which is built per-run
// rather than seeded (see school.spec.ts for why).

test("player and school detail screens fit", async ({ browser }) => {
  // Six screens at two widths, plus building a school from scratch — well past
  // the 30s default, and a timeout here surfaces as "context has been closed"
  // from the cleanup rather than as anything to do with layout.
  test.setTimeout(240_000);
  const db = admin();
  const { data: player } = await db.from("players").select("id").limit(1).single();
  if (!player) throw new Error("no seeded player to open");

  const school = await createSchool({ name: "Playwright High" });
  const pupil = await addSchoolPupil({ school, fullName: "Ravi Kumar", grade: 6 });
  const head = await createSchoolAdmin({ venueId: school.venueId });
  const headState = await getStorageState(head.email, head.password);

  const targets: [role: string, state: StorageState, path: string][] = [
    ["founder", await getStorageState("founder"), `/admin/players/${player.id}`],
    ["coach", await getStorageState("coach"), `/coach/players/${player.id}`],
    ["client", await getStorageState("client"), "/app/players"],
    ["school", headState, "/school"],
    ["school", headState, "/school/more"],
    ["school", headState, `/school/players/${pupil}`],
  ];

  for (const [role, state, path] of targets) {
    for (const { w, h } of WIDTHS) {
      await auditAt(browser, state, path, slug(role, path), w, h);
    }
  }
});
