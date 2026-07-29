# Navigation performance plan

**Status:** Steps 1–6 shipped on `chore/cleanup-and-perf` (2026-07-29), with the
corrections below. Step 7 (`rank_coaches`) untouched — it blocks no navigation.
Written 2026-07-29; re-verified against the code the same day.

## Execution log — read before continuing

**The diagnosis in section B was wrong, and it changed what Step 1 turned out to be.**
`loading.js` "will automatically wrap the `page.js` file and any children below in a
`<Suspense>` boundary" (`node_modules/next/dist/docs/.../loading.md`). A `loading.tsx`
at a segment root therefore already covers every route beneath it — the three existing
files covered all 34 protected routes, and the ~30 "missing" ones were never a gap.
Nothing was ever unprefetched for want of a loading boundary.

What actually made navigation feel frozen, in order of size:

1. **The prefetched shell was being thrown away.** Because every protected route *does*
   sit under a `loading.tsx`, they all live in the client cache's `dynamic` bucket —
   which defaults to **0 seconds**. Next prefetched each shell and discarded it on
   arrival, so every click paid the full round trip again. Step 3 (one config line) was
   the highest-value change in this plan, not the footnote it looks like.
2. **~300ms of auth before any byte could stream.** Step 2, as diagnosed. Correct.
3. **A layout that suppressed its own loading UI.** `app/coach/layout.tsx` was `async`
   and awaited `getCoachPreview()` in its body. Per the same doc, a layout reading
   runtime data means "navigation blocks until the layout finishes rendering" and
   `loading.tsx` shows no fallback — for the whole `/coach` subtree. The plan missed
   this entirely. The banner now sits behind its own `<Suspense>`.

**Other corrections:**

- **Step 2's header handoff was not implemented.** It targeted round trips #3 and #4;
  `getClaims()` already removes #3, and #4 cannot go while `requireUser` returns the
  full profile its callers use (`approval_status`, `onboarded_at`, address). Doing it
  would mean trusting request headers for identity — its own change, with its own
  threat model, not a perf tweak.
- **Step 2's trap #2 is now pinned by a test.** `tests/db/auth-claims.test.ts` asserts
  `getClaims()` makes no `/auth/v1/user` call, *and* that the same interceptor does trip
  on a real `getUser()` — otherwise the assertion would pass vacuously and the silent
  fallback this trap warns about would go unnoticed. Both the live project and the local
  stack sign ES256, so the harness exercises the production path.
- **Step 4 needed no work.** The `from("profiles")` call already sat after the `wanted`
  check, as the plan suspected. With `getClaims()` the public-route cost is local
  crypto, so the matcher was left alone.
- **Step 1 was applied to `/app`, `/app/schedule` and `/app/book`** (the priority-1
  group) plus the coach layout fix. The remaining routes already have loading
  boundaries; per-page `<Suspense>` there is refinement, not a missing floor.
- **Not yet measured.** The plan's "re-measure in Vercel runtime logs" step needs a
  deploy. Nothing here was validated against production latency, and the e2e flow specs
  could not run locally (a `next dev` server was already bound to this project
  directory, and Next refuses a second instance).


**Problem:** clicking any link in the signed-in app (`/app`, `/coach`, `/admin`) is not
instant — the browser sits on the old page, visibly frozen, then swaps.

**Changelog vs the superseded `docs/navigation-performance-plan.md`:**

- Corrected Step 1's "mandatory case": `/app/book/private` does **not** call `rank_coaches`
  and its page render is light (verified `app/app/book/private/page.tsx` — one
  `Promise.all` of three cheap queries; slots load client-side via the `getSlots` server
  action → `get_bookable_slots` after the address step). `rank_coaches` is called only from
  `app/admin/actions.ts:121` (suggest-coach) and `lib/whatsapp/tools/founder.ts:145` — it
  blocks no page navigation. It stays in Step 7 as a DB-side item.
- Corrected the Suspense inventory: `components/app/ClientShell.tsx:17` already wraps
  `PlayerRailLinks` in Suspense. The claim "Suspense appears nowhere in the signed-in tree"
  was wrong in that one place; everything else holds.

**Out of scope (explicit decision):** relocating Vercel/Supabase from Tokyo to Mumbai.
The owner has declined it twice. Everything below assumes the ~130–180ms Tokyo↔India hop
is a fixed cost and works by *removing hops*, not shortening them. Do not re-propose it.

Marketing pages (`/`, `/coaches`, `/locations`, `/colleges`, `/schools`, `/legal/*`) are
already static/ISR as of `bad4852` and are only touched by Step 4.

---

## Diagnosis (verified)

The database is **not** the bottleneck — app queries measure <1ms in `pg_stat_statements`.
Two independent problems compound.

### A. Four serialized Supabase round trips before page data

Users are in India; Vercel is `hnd1` and Supabase `ap-northeast-1` — both Tokyo. Each hop
is ~130–180ms, and these run in series on every protected navigation:

| # | Where | Call |
|---|---|---|
| 1 | `proxy.ts:44` | `supabase.auth.getUser()` |
| 2 | `proxy.ts:60` | `from("profiles").select("role")` |
| 3 | `lib/auth.ts:15` (via `requireUser`) | `supabase.auth.getUser()` **again** |
| 4 | `lib/auth.ts:51` | `from("profiles").select("*")` **again** |

Then the page's own queries run on top. `getCurrentUser` is already React-`cache`d, so
callers within one render share one `getUser` — the duplication is between the **proxy**
and the **render**, which are separate processes the React cache cannot span.

### B. Nothing paints while waiting

Per `node_modules/next/dist/docs/01-app/02-guides/prefetching.md`, a **dynamic** route is
*not prefetched at all* unless it has a `loading.js`. All protected routes are dynamic
(they read the auth cookie). There are 40 protected `page.tsx` routes and only **3**
`loading.tsx` files, all at segment roots (`app/app/`, `app/coach/`, `app/admin/`, 10
lines each). Apart from `ClientShell`'s rail boundary, no signed-in page uses `Suspense`.

So navigating to `/admin/schedule` shows the **old** page until the entire server render
finishes. This is what makes it feel broken rather than merely slow.

---

## Step 1 — Stream every protected route

Biggest *perceived* win. Doesn't reduce total time; removes the frozen-page effect, which
is the actual complaint. No prerequisites.

- Add a `loading.tsx` to each protected segment that lacks one. The three existing ones
  (`app/app/loading.tsx`, `app/coach/loading.tsx`, `app/admin/loading.tsx`) are 10-line
  skeletons — extract one shared skeleton component rather than copying it ~30 more times.
- Wrap the slow data region of each page in `<Suspense>` so static chrome (nav, header,
  rail) paints immediately and data streams in.
- Priority order — highest-traffic first:
  1. `app/app/page.tsx`, `app/app/schedule/page.tsx`, `app/app/book/page.tsx`
  2. `app/coach/page.tsx`, `app/coach/calendar/page.tsx`, `app/coach/players/[playerId]/page.tsx`
  3. `app/admin/schedule/page.tsx`, `app/admin/calendar/page.tsx`, `app/admin/billing/page.tsx`
  4. Remaining `/admin/*` and `/app/*` routes.

**Must land with Step 3** — adding `loading.tsx` silently moves a route's prefetch into
the `staleTimes.dynamic` bucket, which defaults to **0 seconds** (see the trap in Step 3).

**Done when:** every route under `/app`, `/coach`, `/admin` paints chrome within one frame
of the click. Verify by extending an `e2e/flows/` spec per `AGENTS.md` conventions.

---

## Step 2 — Eliminate the duplicate auth round trips

Biggest *real* win: removes 2 of the 4 round trips (~300ms per navigation from India).

### Prerequisite — DONE (verified 2026-07-29). Nothing outstanding.

Project `jkjgdpifimvnptpxjixk` is on **asymmetric ES256 (P-256)** signing — verified live
at `https://jkjgdpifimvnptpxjixk.supabase.co/auth/v1/.well-known/jwks.json`, which
publishes two ES256 keys (current kid `5626253a-…`, previous kid `75119a57-…` retained so
pre-rotation tokens keep verifying) and no HS256. Because the public half is served from a
public JWKS endpoint, the server can verify tokens **locally** — which is what
`getClaims()` does and `getUser()` cannot.

### Implementation

- Swap `supabase.auth.getUser()` → `supabase.auth.getClaims()` in `proxy.ts:44` and
  `lib/auth.ts:15`. `auth-js` 2.110 already ships it (`GoTrueClient.js:5169`) — no
  dependency bump.
- Pass the proxy's verified identity down to the render instead of re-deriving it: set
  user id and role as request headers on the `NextResponse.next({ request })` in
  `proxy.ts`, and have `requireUser` read them via `headers()`. Kills round trip #3, and
  #4 wherever the role is all the page needs.
- Keep the full `profiles` select where the page genuinely needs profile fields
  (`onboarded_at`, `approval_status`, address, billing ids — `lib/auth.ts:84–103`). The
  **role check alone** must stop requiring it.

### Two traps — read before implementing

1. **Session refresh must survive.** The proxy runs on every route so refreshed cookies
   get persisted (a Server Component can't write cookies — see the comment at
   `proxy.ts:90–94`, which is load-bearing). Skipping that rotates the refresh token into
   an invalid state and **signs users out**. Verified safe: `getClaims()` with no argument
   calls `getSession()` internally (`GoTrueClient.js:5173`), which still refreshes an
   expiring token, and the existing `setAll` cookie writer persists it. The swap preserves
   refresh — but any future "optimisation" that skips the proxy does not.
2. **Silent fallback to the network.** `getClaims()` reverts to a full `getUser()` call
   if the token's alg is `HS*`, has no `kid`, or WebCrypto is unavailable
   (`GoTrueClient.js:5190–5195`). None apply here (ES256 + `kid` + Node WebCrypto), but it
   fails *quietly* — you'd get zero speedup and no error. Assert the fast path in a test
   or check Vercel runtime logs for unexpected auth calls.

### Tradeoff to accept knowingly

`getClaims()` verifies the *token*, not the database. A revoked user or changed role stays
valid until the access token expires (~1h). Acceptable — role changes are rare — and the
`approval_status` / `onboarded_at` redirects in `requireUser` still read the DB, so those
stay immediate.

**Done when:** a protected navigation makes at most one Supabase network call before page
data. Confirm in Vercel runtime logs.

---

## Step 3 — Turn the client router cache back on

One config line; pairs with Step 1 and prevents it from underdelivering.

Per `staleTimes.md` and `prefetching.md`:

| Route has | What gets prefetched | Cache lifetime |
|---|---|---|
| No `loading.js` | entire page | `staleTimes.static` — **5 min** |
| With `loading.js` | layout → first loading boundary | `staleTimes.dynamic` — **0s, off by default** |

The trap: Step 1 adds `loading.tsx` everywhere, which moves each route from the 5-minute
bucket into the **0-second** bucket. Without this step, prefetched shells are discarded
immediately and re-fetched on every navigation.

Add to `next.config.ts`:

```ts
experimental: {
  staleTimes: { dynamic: 30, static: 180 },
}
```

`dynamic: 30` means re-visiting a route within 30s reuses the cached shell — instant
back/forward and tab-switching. Still flagged `experimental` in Next 16.2.10; re-check at
upgrade time.

**Caveat:** 30s of staleness on dashboard data. If a screen must always be fresh after a
mutation, the fix is `revalidatePath`/`revalidateTag` in the server action — not lowering
this globally. `revalidateTag(tag, profile)` requires the 2nd arg in Next 16 (use
`"max"`).

---

## Step 4 — Stop public routes paying the auth tax

`proxy.ts` calls `getUser()` at line 44 and only *then* checks whether the path is
protected at line 47. Every marketing page pays a **full Tokyo auth round trip before
serving cached HTML**, partly negating the static/ISR work from `bad4852`.

The naive fix — early-return for non-protected paths before the auth call — is **wrong**:
it reintroduces trap #1 (lost cookie refresh → silent logouts). Do it properly:

- Land Step 2 first. Once `getClaims()` verifies locally, the cost on public routes drops
  to microseconds on its own and this step is mostly self-solving.
- Then tighten the matcher (`proxy.ts:95–97`) only if measurement still warrants it.
- Do the unambiguously safe part regardless: move the `from("profiles")` call at
  `proxy.ts:60` after the `wanted` check so public routes never hit PostgREST. (As
  written today it already sits after the `if (!wanted) return` — **verify** the ordering
  at implementation time and only reorder if a regression reintroduced it.)

---

## Step 5 — Collapse sequential query stages

Modest but cheap: each collapsed stage is one fewer ~150ms round trip. Audited: **no N+1
loops** — the `.in()` batching in `app/admin/weekly/page.tsx` is correct. The issue is
independent queries awaited in series.

- `app/admin/weekly/page.tsx` — the bookings query (line 115) and the series-bookings
  query (line 177) are independent of each other (115 needs `nextByClass`, 177 needs
  `series` from the `Promise.all` at line 36). Run them concurrently.
- `app/app/page.tsx` — `getMasteryMap` (line 29) genuinely depends on the `Promise.all`
  at line 19. Not fixable by reordering; push it behind a Suspense boundary in Step 1, or
  have the DB return both in one call.
- Re-audit the other multi-await pages the same way: `app/admin/players/page.tsx`,
  `app/coach/session/[id]/page.tsx`, `app/coach/players/[playerId]/page.tsx`,
  `app/coach/page.tsx`, `app/app/players/[playerId]/page.tsx`,
  `app/admin/schedule/page.tsx`.

Rule of thumb: an `await` whose inputs were all available before the previous `await`
belongs in the previous `Promise.all`.

---

## Step 6 — Trim what crosses the wire (lowest priority)

Only after 1–5 are measured.

- **`select("*")`** — 6 sites: `lib/auth.ts:53`, `lib/auth.ts:74`, and 4 in
  `lib/whatsapp/identity.ts` (`:73, :84, :154, :172`). `lib/auth.ts:53` runs on every
  protected navigation — narrow it to the columns `Profile` actually declares. The
  identity.ts ones are on the WhatsApp path, not navigation; lower priority.
- **Client-component ratio:** 72 files under `app/` + `components/` carry `"use client"`
  (~13,000 lines; the largest are `AdminAddSheet` 842, `AdminSessionSheet` 728,
  `CoachManager` 685, `PrivateWizard` 654, `ClientManager` 623). Audit the biggest for
  whether the client part can be pushed to a leaf island (the pattern already used for
  `StageHeader`/`AuthCta`).
- **Already good, don't regress:** `mapbox-gl` is lazy-imported in
  `components/app/LocationPinMap.tsx:47` and `components/marketing/VenueMap.tsx:47`. It
  is the heaviest dependency; keep it behind `await import()`.

---

## Step 7 — `rank_coaches` (separate issue)

~1330ms and genuinely database-bound, unlike everything above. Callers:
`app/admin/actions.ts:121` (admin suggest-coach) and `lib/whatsapp/tools/founder.ts:145`.
It blocks **no page navigation** — it runs inside an admin action and a bot tool — so it
is out of this plan's critical path. It still deserves its own pass (index review, or
splitting ranking from the availability scan). Per `AGENTS.md`, any change to it must run
`npm run test:db` and update the affected `tests/db/` specs in the same commit.

---

## Sequencing

1. **Step 1 + Step 3 together** — perceived-speed win; Step 3 must accompany Step 1.
2. **Step 2** — the real ~300ms saving.
3. **Step 4** — largely falls out of Step 2.
4. Re-measure in Vercel runtime logs.
5. **Steps 5–7** only if the numbers still warrant it.
