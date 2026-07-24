# Viewport audit (Playwright)

A lightweight, Chromium-only viewport harness for the mobile audit passes. Each
spec loads a route at two phone widths (360×740 and 390×844), asserts the page
does **not** scroll horizontally, and saves a full-page screenshot under
`test-results/screens/`. The fold / tap-target review stays human — eyeball the
screenshots.

Run it:

```bash
npm run e2e
```

The dev server is started for you (`webServer` in `playwright.config.ts`) and an
already-running `localhost:3000` is reused.

## Public vs. authenticated

`public.spec.ts` needs no login. The role specs (`client`, `coach`, `admin`)
audit surfaces behind auth.

**The app has no password login** — sign-in is email-OTP + OAuth only, so
Playwright can't script it. Instead each role spec loads a storage state you
capture by hand, and **skips cleanly** when the state file is missing (so a
fresh clone or CI never fails on missing auth).

## Capturing auth state (once per role)

```bash
npx playwright codegen --save-storage=e2e/.auth/client.json http://localhost:3000/login
```

Complete the email OTP by hand in the window that opens, land on the app, then
close the window — the session is written to `e2e/.auth/client.json`. Repeat
with `coach.json` and `admin.json`, signing in as each role.

Re-capture when a role spec starts failing on auth — Supabase refresh tokens
rotate, so a stored state eventually goes stale.

The `.auth/` directory and `test-results/` are gitignored — nothing here is
committed.
