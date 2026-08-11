// Screenshot the styleguide's component specimens, both moods, phone + desktop.
//
// This exists so a design change can be LOOKED AT rather than reasoned about.
// The admin screens need an auth session and a seeded database to reach, so the
// states that matter most — a live class with no coach, a finished one nobody
// marked — are the exact ones you cannot summon on demand. /styleguide renders
// the real components with fabricated rows and needs neither, so it is the one
// page where every state exists at once.
//
//   npm run dev                       # in one terminal
//   node scripts/shoot-styleguide.mjs # in another
//
// Writes PNGs to .screenshots/ (gitignored). Pass a directory to change that,
// and PORT=xxxx if the dev server is not on 3000.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.argv[2] || ".screenshots");
const PORT = process.env.PORT || "3000";
const URL = `http://localhost:${PORT}/styleguide`;

// Each entry is one specimen block on the page, by its data-spec attribute.
// Add a block to app/styleguide/page.tsx, add its name here, and it is shot.
const SPECS = ["session-cards"];
const WIDTHS = [
  [1280, "desktop"],
  [390, "mobile"],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
let wrote = 0;

for (const [width, tag] of WIDTHS) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    // 2x so 11px badge text is actually readable in the PNG — the whole point
    // is to check type and colour, and at 1x the uppercase tracking smears.
    deviceScaleFactor: 2,
  });
  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 120_000 });
  } catch {
    console.error(`Could not reach ${URL} — is \`npm run dev\` running?`);
    process.exitCode = 1;
    break;
  }
  // The styleguide 404s outside development on purpose.
  if (await page.locator("text=404").first().isVisible().catch(() => false)) {
    console.error("Got a 404 — /styleguide only renders in development.");
    process.exitCode = 1;
    break;
  }
  for (const spec of SPECS) {
    await page.waitForSelector(`[data-spec="${spec}"]`, { timeout: 120_000 });
    // Let the webfonts land: shooting mid-swap measures Inter's fallback and
    // every badge comes out a different width than it ships at.
    await page.waitForFunction(() => document.fonts.ready.then(() => true));
    await page.waitForTimeout(400);
    for (const mood of ["studio", "stage"]) {
      // `section`, not `[data-mood]` alone: the page's own root div is also
      // data-mood="studio", so the bare attribute selector matches every panel
      // on the page and .first() silently hands back the wrong mood.
      const el = page.locator(`section[data-mood="${mood}"] [data-spec="${spec}"]`).first();
      if (!(await el.count())) continue;
      const file = `${OUT}/${spec}-${mood}-${tag}.png`;
      await el.screenshot({ path: file });
      console.log(file);
      wrote++;
    }
  }
  await page.close();
}

await browser.close();
if (wrote) console.log(`\n${wrote} screenshots in ${OUT}`);
