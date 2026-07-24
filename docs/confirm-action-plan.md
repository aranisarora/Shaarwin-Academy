# Shared ConfirmAction + retire window.confirm + Playwright viewport harness

Status: planned, not implemented. Written against commit `9648ba4` on `main`.
Work directly on `main`; push to `main` when each commit passes lint + build.

This document is decision-complete: follow it as written. Every site below has been
verified by reading the code at `9648ba4` — do not re-diagnose, but DO re-read each
named file in full before editing it. Read `AGENTS.md` first (this Next.js version
has breaking changes vs. your training data — copy in-repo patterns, never write
API usage from memory). **No database, server-action-signature, or route changes
anywhere in this plan.**

## Why

The two-tap in-sheet confirm pattern exists because native `window.confirm` looks
broken in a PWA and truncates copy on small screens. The coach/client/admin mobile
plans all said "if any window.confirm remains, remove it" — but ~10 native calls
still live in the admin managers, and the two-tap component is duplicated in
`AdminSessionSheet.tsx` and `ScheduleList.tsx`. This plan extracts one shared
primitive, finishes the migration, and lands the Playwright viewport harness that
both mobile plans left as their only outstanding item.

## Verification already done (do not redo)

The three prior plan docs are implemented and verified against the code:

- `docs/fixes-and-cleanup-plan.md` — Parts 1–4 shipped as `f495f91`, `3e23f89`,
  `66bfce7`, `a626b77` (+ lint fix `cdb8502`). Part 5 (Twilio template approval)
  is founder-manual and already tracked in `docs/whatsapp-interactive.md`.
- `docs/coach-mobile-plan.md` — Phases 1–2 shipped as `7773bdb`, `c63b3d9`
  (day collapse via `CoachScheduleDays`, ✓ All present, inline can't-make-it,
  autosave status, assessments nudge all present in `SessionRoster.tsx`);
  Phase 3.1 shipped as `58aff3f`. Only Phase 3.2 (viewport pass) remains → Part 4 here.
- `docs/client-mobile-plan.md` — Phases 1–3 shipped as `1d095f9`, `1d9bb8a`,
  `eaf1905`, `9648ba4` (`BookModeSwitch.tsx`, FilterBar + map chip in
  `BookBrowser.tsx`, two-tap cancels in `ScheduleList.tsx`, Home/Membership
  tweaks). Only Phase 4 (viewport pass) remains → Part 4 here.

`npm run lint` and `npm run build` pass clean at `9648ba4`.

---

## Part 0 — Docs housekeeping

Repo convention (see commit `61a2fbc`) is to delete implemented plan docs.

1. Delete `docs/fixes-and-cleanup-plan.md`, `docs/coach-mobile-plan.md`,
   `docs/client-mobile-plan.md`. Their only outstanding items are discharged by
   Part 4 of this plan (viewport passes) or tracked in
   `docs/whatsapp-interactive.md` (Twilio approval, founder-manual).

Commit: `docs: ConfirmAction plan lands; implemented plan docs retired`
(include this file in the same commit).

## Part 1 — Extract the shared component

Create `components/ui/ConfirmAction.tsx` exactly as follows (lifted verbatim from
`AdminSessionSheet.tsx` lines 49–94, plus the `keepLabel` prop; the back-out label
standardizes on "Keep" — `ScheduleList`'s "Keep it" wording is dropped):

```tsx
"use client";

// A destructive action that confirms in two taps inside the sheet — native
// window.confirm dialogs look broken in a PWA and truncate copy on small
// screens. First tap arms it (prompt + Keep/confirm); "Keep" backs out, the
// confirm button runs the action. Shared by the admin, coach and client sheets.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export function ConfirmAction({
  label,
  confirmLabel,
  prompt,
  onConfirm,
  pending,
  variant = "destructive",
  keepLabel = "Keep",
}: {
  label: string;
  confirmLabel: string;
  prompt: string;
  onConfirm: () => void;
  pending: boolean;
  /** Trigger button style; the confirm button is always destructive. */
  variant?: "destructive" | "ghost";
  keepLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button
        variant={variant}
        className="w-full"
        disabled={pending}
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-[8px] border border-line p-3">
      <p className="text-sm text-fg-2">{prompt}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" disabled={pending} onClick={() => setArmed(false)}>
          {keepLabel}
        </Button>
        <Button variant="destructive" disabled={pending} onClick={onConfirm}>
          {pending ? <Spinner /> : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
```

**Disarm-after-toggle rule.** The component stays armed after `onConfirm`
completes. That's fine when success closes the sheet (most sites), but on
toggle actions where the sheet stays open (block/unblock), pass a `key` derived
from the toggled state — e.g. `key={selected.disputed ? "blocked" : "open"}` —
so a successful toggle remounts the component disarmed with the other state's copy.

## Part 2 — Dedupe the two existing copies

- `components/app/AdminSessionSheet.tsx` — delete the local `ConfirmAction`
  function (lines 49–94), add
  `import { ConfirmAction } from "@/components/ui/ConfirmAction";`.
  The three existing `<ConfirmAction>` call sites are unchanged. (`Button` and
  `Spinner` are still used elsewhere in the file — keep those imports.)
- `components/app/ScheduleList.tsx` — same: delete the local copy (lines 70–115),
  import the shared one. Two call sites unchanged; the back-out button now reads
  "Keep" instead of "Keep it" (intended).

## Part 3 — Migrate every remaining `window.confirm`

All remaining sites are in `components/` (verified: none in `app/`). For each
button site: replace the trigger `<Button>` with `<ConfirmAction>`, move the
button's copy into `label`, the confirm text into `prompt`, pick a short verb
phrase for `confirmLabel`, and strip the `if (!window.confirm(...)) return;`
guard so `onConfirm` runs the action directly. **Read each handler in full
first** — several compute copy from current state; preserve that branching by
computing `label` / `prompt` / `confirmLabel` from the same condition.

### Straightforward button sites

| File · line | Action | Notes |
|---|---|---|
| `AdminClassSheet.tsx` ~322 | "End class" | `label="End class"`, `confirmLabel="End the class"`, prompt = existing confirm text. Success calls `onDone` (sheet closes). |
| `ClientManager.tsx` ~196 + ~390 | "Remove client" (pending invite) | Handler `removeInvite`; strip the guard, wire the button through `<ConfirmAction>`. |
| `ClientManager.tsx` ~563 | Block / Unblock bookings | `variant="ghost"`. Copy branches on `selected.disputed`. Sheet stays open on success → add `key={selected.disputed ? "blocked" : "open"}`. |
| `ClientManager.tsx` ~587 | Archive / Restore client | Trigger variant: `destructive` when archiving, `ghost` when restoring (matches today's button). Copy branches on `selected.archived`. Success closes the sheet. |
| `CoachManager.tsx` ~250 + ~602 | "Remove invite" | Handler `revokePending`; strip the guard. |
| `CoachManager.tsx` ~526 | Pause / Unpause coach | `variant="ghost"`. Copy branches on `editActive`. Success calls `close()`. |
| `CoachManager.tsx` ~570 | "Remove coach" | Prompt depends on the replacement select: compute it at render from `replacementId` (`coaches.find(...)`) — it updates live as the select changes, which is correct. |
| `VenueManager.tsx` ~141 | "Delete venue" | Prompt = existing confirm text. Success closes the sheet. |

### Exception A — coach-clash override, `AdminClassSheet.tsx` ~106 (`applyCoach`)

This confirm fires **after** the server responds mid-transition (`filter_failed`),
so it cannot use ConfirmAction (which arms *before* the action). Port the pattern
`AdminSessionSheet.tsx` already uses (its `coachOverride` state, the bordered
panel at its lines 622–642, and `applyCoachOverride`):

- Add `const [coachOverride, setCoachOverride] = useState<string | null>(null);`.
- In `applyCoach`, on `filter_failed`: `setCoachOverride(r.error ?? "That coach doesn't fit the rules.")`
  and return (drop the `window.confirm` + inline retry).
- Add `applyCoachOverride()` calling `reassignClassCoach(cls.id, coachTarget, lock, true)`,
  clearing the override, and reusing the **same success copy** `applyCoach` has
  (including the `r.skipped` branch — factor it into a small helper if that's cleaner).
- In the "Coach — every week" section, render the override panel in place of the
  "Set coach for every week" button when `coachOverride` is set — copy the JSX
  shape from `AdminSessionSheet.tsx` (prompt + Keep / "Assign anyway").

### Exception B — "Delete completely (mistakes only)", `AdminClassSheet.tsx` ~344

A deliberately subtle text-link, not a `<Button>` — don't force it into the
button-shaped component. Give it a small inline two-step that keeps the text-link
affordance: local `const [deleteArmed, setDeleteArmed] = useState(false);`; the
first tap arms; when armed, render in its place a compact panel styled like
ConfirmAction's armed state (prompt "Delete this class completely? Only works if
nobody ever booked it." + ghost "Keep" / destructive "Delete class" buttons).
This still removes the `window.confirm`.

### Exception C — household player "Remove", `ProfileEditor.tsx` ~139

A per-row small text button inside a list row — a full-width armed panel doesn't
fit. Inline two-step scoped to the row: `const [removeArmed, setRemoveArmed] =
useState<string | null>(null);` (holds the player id). First tap arms that row;
while armed, the row shows the short prompt ("Remove {name}? Their history stays
but won't be visible.") with small "Keep" / "Remove" actions (keep tap targets
≥44px high — `min-h-11` or matching padding, same as the rest of the row).
Tapping elsewhere isn't required to disarm; the "Keep" action is enough.

### Not in scope

`SessionRoster.tsx`'s `cantArmed` arms a whole multi-button row — it doesn't fit
the single-trigger component. Leave it (no `window.confirm` there anyway).

Commit: `refactor(ui): share ConfirmAction and retire native window.confirm dialogs`

## Part 4 — Playwright viewport harness (discharges both mobile plans' test pass)

Verdict: install it. Both mobile plans left this as their only outstanding item,
and a repeatable viewport harness pays for itself on every future sheet-heavy UI
change. Keep it lightweight: Chromium only, screenshots + one hard assertion
(no horizontal scroll); fold/tap-target review stays human (screenshots).

**Constraint discovered during planning: the app has no password login** —
`AuthForm.tsx` is email-OTP + OAuth only. Playwright therefore cannot script a
login. Authenticated surfaces use manually captured storage state; specs skip
cleanly when no state file exists, so the harness never blocks CI or a fresh clone.

1. `npm i -D @playwright/test` then `npx playwright install chromium`.
2. `playwright.config.ts`:

   ```ts
   import { defineConfig } from "@playwright/test";

   export default defineConfig({
     testDir: "e2e",
     use: { baseURL: "http://localhost:3000" },
     projects: [
       { name: "android-small", use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
       { name: "iphone-14", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
     ],
     webServer: {
       command: "npm run dev",
       url: "http://localhost:3000",
       reuseExistingServer: true,
       timeout: 120_000,
     },
   });
   ```

3. `e2e/viewport.ts` helper:

   ```ts
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
   ```

4. `e2e/public.spec.ts` — run `auditViewport` over the public routes. Enumerate
   them from the `npm run build` route table (at `9648ba4` that includes `/`,
   `/login`, `/signup`, `/schools`, `/styleguide` — verify against the build
   output, don't guess).
5. `e2e/client.spec.ts`, `e2e/coach.spec.ts`, `e2e/admin.spec.ts` — each starts with

   ```ts
   const state = "e2e/.auth/client.json"; // coach.json / admin.json
   test.use({ storageState: state });
   test.skip(!fs.existsSync(state), "capture auth state first — see docs");
   ```

   and audits that role's surfaces: client — `/app`, `/app/book`,
   `/app/book/private`, `/app/schedule`, `/app/players`, `/app/membership`,
   `/app/more` (verify exact routes from the build table); coach — `/coach`,
   `/coach/players`, one `/coach/session/[id]`; admin — `/admin`,
   `/admin/schedule`, `/admin/weekly`, `/admin/players`.
6. Capturing auth state (founder does this once per role, documented in a short
   `e2e/README.md`): `npx playwright codegen --save-storage=e2e/.auth/client.json http://localhost:3000/login`,
   complete the email OTP by hand, close the window. Re-capture when a spec
   starts failing on auth (Supabase refresh tokens rotate).
7. `.gitignore`: add `/test-results/`, `/playwright-report/`, `/e2e/.auth/`.
   `package.json`: add `"e2e": "playwright test"`.
8. Run the pass, eyeball every screenshot for: first real content above the
   fold, tap targets ≥44px, no clipped sheets. Fix only what the audit surfaces
   (presentation-only), as small follow-up commits.

Commit: `test(e2e): Playwright viewport harness for the mobile audit passes`

## Verification (after Parts 1–3, before pushing)

- `npm run lint` and `npm run build` pass.
- `grep -rn "window.confirm" components/ app/` returns **nothing**.
- Manual smoke, per migrated sheet (admin class, client, coach, profile, venue):
  arm a destructive action → "Keep" backs out; confirm runs it; toggle-state
  actions (block/archive/pause) show the right copy in **both** states, and
  block/unblock disarms after a successful toggle (the `key` rule).
- Playwright: `npm run e2e` — public specs pass everywhere; role specs pass
  where auth state has been captured.

## Sequencing

| Part | What | Size |
|---|---|---|
| 0 | Docs housekeeping | ~5 min |
| 1–2 | Shared component + dedupe | ~20 min |
| 3 | Migration (10 sites, 2 exceptions) | ~1–1.5 h |
| 4 | Playwright harness + audit run | ~1 h |

Push to `main` after each commit passes lint + build.
