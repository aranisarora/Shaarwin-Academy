# Instant navigation plan — finish the streaming work

**Status:** not started. Written 2026-07-29, immediately after
`docs/plans/navigation-performance.md` Steps 1–6 shipped on `chore/cleanup-and-perf`.
**Audience:** implementing model, starting from a cold context.
**Branch:** continue on `chore/cleanup-and-perf` (see the branch note in
`docs/plans/README.md`). `main` stays untouched until the owner verifies with
`npm run dev` and says to merge.

Every claim below was verified on 2026-07-29 by reading the code, the Next 16.2.10 docs
in `node_modules/next/dist/docs/`, or by running the command shown, **unless marked
Verify**. Treat anything marked Verify as a claim to re-check, not a fact — the two
previous plans in this directory each had a load-bearing error that only surfaced during
implementation.

---

## What already shipped (do not redo)

From `docs/plans/navigation-performance.md`, all on `chore/cleanup-and-perf`:

| Commit | What |
|---|---|
| `1385129` | `experimental.staleTimes = { dynamic: 30, static: 180 }` in `next.config.ts` |
| `0b050ba` | `getUser()` → `getClaims()` in `proxy.ts` and `lib/auth.ts`; `tests/db/auth-claims.test.ts` pins the local-verify fast path |
| `71c5237` | `<Suspense>` on `/app`, `/app/schedule`, `/app/book`; `app/coach/layout.tsx` preview banner moved behind its own boundary |
| `24991e3` | The two independent booking queries on `/admin/weekly` now overlap |
| `427702d` | `requireUser` selects the 14 `Profile` columns instead of `select("*")` |

**A correction that matters for this plan.** The previous plan claimed the app was
missing ~30 `loading.tsx` files. It was not: per
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`,
a `loading.js` "will automatically wrap the `page.js` file and any children below in a
`<Suspense>` boundary". The three files at `app/app/`, `app/coach/` and `app/admin/`
already cover all 34 protected routes. **Do not add 31 more `loading.tsx` files.**

---

## The honest current state

`npm run build`, `npx tsc --noEmit`, `npm run lint`, `npm run test` (15) and
`npm run test:db` (16) all pass on the branch head.

Streaming is implemented on **3 of 34** protected routes:

```
grep -rln "Suspense" app/app app/coach app/admin --include=*.tsx
# app/app/book/page.tsx, app/app/page.tsx, app/app/schedule/page.tsx, app/coach/layout.tsx
```

And even on those three, navigation is **not yet instant**. Every one of the 30 pages
that calls `requireUser` awaits it *before* returning any JSX:

```tsx
// app/app/schedule/page.tsx — the shape all 30 share
export default async function SchedulePage() {
  const { supabase, user } = await requireUser("/app/schedule");   // ← cookies + one Supabase round trip
  return (
    <ClientShell title="Schedule">          {/* nothing paints until the line above resolves */}
      <Suspense fallback={<PageSkeleton />}>
        <Bookings supabase={supabase} userId={user.id} />
      </Suspense>
    </ClientShell>
  );
}
```

So the app currently streams *page data* under the shell, but the **shell itself still
waits one Supabase round trip**. That is the gap this plan closes.

---

## Phase A — make the shell paint before auth resolves

The highest-value remaining work, and a prerequisite for Phase C.

`requireUser` does two separable jobs: it **guards** (redirects) and it **supplies data**
(`profile`, `supabase`, `user`). Only the guard has to happen before the page is allowed
to render; the data does not.

Target shape:

```tsx
export default async function SchedulePage() {
  return (
    <ClientShell title="Schedule">        {/* paints immediately — no auth needed */}
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <Bookings />                     {/* calls requireUser itself */}
        </Suspense>
      </div>
    </ClientShell>
  );
}
```

- Start with the routes whose shell title is **static** — no `profile` needed to render
  the chrome. `/app/schedule` and `/app/book` are already refactored and only need
  `requireUser` pushed one level down. Then the rest of `/coach/*` and `/admin/*`.
- `/app` (`app/app/page.tsx`) is the awkward one: its title is
  `` `Hi, ${profile.full_name.split(" ")[0]}` ``. Either accept a shell that waits, or
  render `<ClientShell title={<Suspense fallback={<Skeleton …/>}><Greeting/></Suspense>}>`.
  `StudioShell` already accepts `React.ReactNode` for `title` (`components/shells/StudioShell.tsx`),
  and the three `loading.tsx` files already pass `<Skeleton className="h-6 w-32" />` as a
  title — so this is supported today, no shell change needed.

### The trap that decides this phase

`requireUser` (`lib/auth.ts`) does more than fetch — it calls `redirect()`:

- `approval_status !== "approved"` → `/app/pending`
- `!onboarded_at` → `/app/onboarding`

Move it behind a Suspense boundary and those redirects fire **after the shell has already
flushed**, so an unapproved or unonboarded client sees the destination chrome flash before
being bounced. Per the `loading.js` doc, once streaming has begun the response status
cannot change either.

Pick one, deliberately, and write the choice into the commit message:

1. **Move both gates into `proxy.ts`** — it already reads `profiles` for the role check
   (`proxy.ts`, after the `wanted` check), so adding `approval_status` and `onboarded_at`
   to that existing `select` costs **zero** extra round trips and redirects before any
   HTML is sent. This is the recommended option; it also makes `requireUser` a pure data
   read, which Phase C wants anyway.
2. Keep the gates in `requireUser` and accept the flash on those two rare paths.
3. Keep `requireUser` blocking on `/app/*` only (where the gates apply) and go
   shell-first on `/coach/*` and `/admin/*`, whose users are always approved.

**If you take option 1:** the redirect logic must stay correct for coaches and founders,
who are exempt from both gates — see the `p.role === "client" &&` conditions in
`lib/auth.ts`. Add a `tests/db/` spec per `AGENTS.md`, and note that `e2e/flows/` has an
auth smoke spec per role that should catch a regression here.

**Done when:** clicking any signed-in nav link paints the destination chrome within one
frame, with a skeleton where data will land — before any Supabase call completes.

---

## Phase B — finish streaming the remaining 31 routes

Mechanical once Phase A sets the pattern. Establish it on one route per role app first,
then repeat.

Priority (highest traffic first):

1. `app/coach/page.tsx`, `app/coach/calendar/page.tsx`, `app/coach/session/[id]/page.tsx`
2. `app/admin/page.tsx`, `app/admin/schedule/page.tsx`, `app/admin/weekly/page.tsx`
3. `app/admin/players/page.tsx`, `app/admin/billing/page.tsx`, `app/app/players/[playerId]/page.tsx`
4. Everything else under `/admin/*`, `/coach/*`, `/app/*`

The extraction pattern used in `71c5237` (copy it):

```tsx
type DB = Awaited<ReturnType<typeof requireUser>>["supabase"];

async function Body({ supabase, userId }: { supabase: DB; userId: string }) { … }
```

While you are in each file, fold in the **Step 5 re-audit** the previous plan left open —
an `await` whose inputs were all available before the previous `await` belongs in the
earlier `Promise.all`. Unaudited, with their await counts as of 2026-07-29:
`app/admin/players/page.tsx` (6), `app/coach/session/[id]/page.tsx` (5),
`app/coach/players/[playerId]/page.tsx` (5), `app/coach/page.tsx` (4),
`app/app/players/[playerId]/page.tsx` (4), `app/admin/schedule/page.tsx` (4).
**Verify** each before rewriting — a high await count is a hint, not a finding.

> Supabase query builders are **lazy**: assigning one to a variable dispatches nothing.
> Calling `.then()` is what starts the request. That is what makes the overlap in
> `24991e3` real, and it is the easiest thing to get silently wrong here.

---

## Phase C — Cache Components + `unstable_instant` (the real prize; decide before starting)

This is the only way to get *validated* instant navigation rather than
looks-fast-on-my-machine. It is also an **app-wide architectural change**, not a per-route
one. Read `node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md` and
`migrating-to-cache-components.md` (723 lines) in full before touching anything.

Verified facts:

- `unstable_instant` **only works when `cacheComponents` is enabled**
  (`.../02-route-segment-config/instant.md`), and **throws in Client Components**.
  Both that file and the guide are marked `version: draft` — the API can move.
- `cacheComponents` is a real config key in 16.2.10
  (`next/dist/server/config-schema.d.ts:61`).
- With Cache Components, reading `cookies()`/`headers()`/`searchParams` outside a
  `<Suspense>` boundary raises the **blocking-route** insight. Every protected page reads
  cookies via `requireUser`, so **Phase A is a hard prerequisite** — attempt this first
  and all 30 pages light up as blocking at once.
- It ships tooling worth having: `experimental.instantNavigationDevToolsToggle` (an
  "Instant Navs" panel that freezes the page at its static shell) and an `instant()`
  helper in `@next/playwright` for asserting exactly what appears in the instant shell —
  which would fit `e2e/flows/` per `AGENTS.md`.

**Verify before committing to this:** whether `experimental.staleTimes` (shipped in
`1385129`) still applies, is ignored, or conflicts once `cacheComponents` is on. The docs
consulted did not say. If it conflicts, that is a deliberate trade to put to the owner,
not a silent revert.

**Recommendation:** do Phases A, B and D first and *measure*. If real-world navigation is
acceptable after those, Phase C is a large migration against a draft API for diminishing
returns — put the decision to the owner with the measurements in hand rather than
starting it speculatively.

---

## Phase D — measure and verify (nothing here has been measured)

**No change from either performance plan has been validated against production latency.**
Everything so far is reasoning from the docs plus a green build.

1. **Deploy the branch to a Vercel preview** and compare against production for a signed-in
   navigation from India. Confirm in Vercel runtime logs that a protected navigation now
   makes **at most one** Supabase call before page data (the `getClaims` win).
2. **Run the e2e flows** — `npm run e2e:flows`. This has **never been run against any of
   this work**. It failed on 2026-07-29 with:

   ```
   [WebServer] ⨯ Another next dev server is already running.
   ```

   Next refuses a second `next dev` for the same project directory, and the config needs
   its own server on port 3100. **Ask the owner to stop their dev server first**, then
   re-run. Do **not** point the flows at the server on :3000 — `e2e/flows/global.setup.ts`
   resets the database and that server is wired to the **live** project.
3. Re-check the two UX deltas from the cleanup plan on `npm run dev`: ProfileEditor's
   player-remove rows, and `ManageBillingButton` (which now asks a confirmation question
   it previously did not).

---

## Leftovers from the two finished plans

- **`ui/DateInput`** (`docs/plans/codebase-cleanup.md` Phase 5) — deliberately not built.
  It is a design job, not a dedup: the point is to stop `<input type="date">` following
  the OS locale, mirroring the reasoning in `components/app/TimeSelect12h.tsx`. Six call
  sites: `AdminAddSheet` (:580, :716, :762), `AdminCalendarNav` (:113),
  `AdminSessionSheet` (:623), `ProfileEditor` (:158).
- **Step 2's proxy→render header handoff** — not done, and mostly moot: `getClaims()`
  already removed the round trip it targeted. The remaining half needs `requireUser` to
  stop returning the full profile, which Phase A option 1 would enable. If revisited,
  note it means trusting request headers for identity — the proxy must overwrite them
  unconditionally so a client cannot spoof them.
- **Step 6, client-component ratio** — 73 files under `app/` + `components/` carry
  `"use client"`. Largest: `AdminAddSheet`, `AdminSessionSheet`, `CoachManager`,
  `PrivateWizard`, `ClientManager`. Audit whether the client part can be pushed to a leaf
  island (the `StageHeader`/`AuthCta` pattern). Keep `mapbox-gl` lazy-imported.
- **Step 7, `rank_coaches`** (~1330ms) — genuinely DB-bound but blocks **no** navigation;
  it runs from `app/admin/actions.ts` (suggest-coach) and `lib/whatsapp/tools/founder.ts`.
  Its own pass: index review, or split ranking from the availability scan. Per `AGENTS.md`
  any change to it runs `npm run test:db` and updates the affected specs in the same commit.

---

## Gate after each phase

```
npx tsc --noEmit && npm run lint && npm run test && npm run test:db && npm run build
```

`test:db` needs Docker + `npm run db:start`. Commit one plan item at a time so a bad
change bisects cleanly, and push after each phase.

**Record corrections in an execution log at the top of this file as you go** — that
convention is the reason the two previous plans' errors were caught rather than inherited.
