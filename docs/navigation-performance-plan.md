# Navigation performance plan

**Status:** not started. Written 2026-07-29.
**Problem:** clicking any link in the signed-in app (`/app`, `/coach`, `/admin`) is not
instant — the browser sits on the old page, visibly frozen, then swaps.

**Out of scope (explicit decision):** relocating Vercel/Supabase from Tokyo to Mumbai. It
is the single largest available number, but it's a full Supabase project migration and the
owner has declined it twice. Everything below assumes the ~130–180ms Tokyo↔India hop is a
fixed cost, and works by *removing hops* rather than shortening them. Do not re-propose the
migration as part of this plan.

Marketing pages (`/`, `/coaches`, `/locations`, `/colleges`, `/schools`, `/legal/*`) are
already static/ISR as of commit `bad4852` and are only touched by Step 4.

---

## Diagnosis

The database is **not** the bottleneck — app queries measure <1ms in `pg_stat_statements`.
Two independent problems compound.

### A. Four serialized Supabase round trips before page data

Users are in India; Vercel is `hnd1` and Supabase is `ap-northeast-1` — both Tokyo
(`vercel.json`). Each hop is ~130–180ms, and these are sequential:

| # | Where | Call | Network? |
|---|---|---|---|
| 1 | `proxy.ts:44` | `supabase.auth.getUser()` | yes — Supabase Auth |
| 2 | `proxy.ts:60` | `from("profiles").select("role")` | yes — PostgREST |
| 3 | `lib/auth.ts:15` (via `requireUser`) | `supabase.auth.getUser()` **again** | yes — Supabase Auth |
| 4 | `lib/auth.ts:51` | `from("profiles").select("*")` **again** | yes — PostgREST |

Then the page's own queries run on top.

`getCurrentUser` (`lib/auth.ts:11`) is already React-`cache`d, so callers *within one render*
share a single `getUser` — that optimisation is intact. The duplication is between the
**proxy** and the **render**: separate processes, so the React cache cannot span them.
Rows 1–2 and 3–4 are the same two questions asked twice.

### B. Nothing paints while waiting

Per `node_modules/next/dist/docs/01-app/02-guides/prefetching.md`, a **dynamic** route is
*not prefetched at all* unless it has a `loading.js`. All protected routes are dynamic
(they read the auth cookie). There are **34** protected `page.tsx` routes and only **3**
`loading.tsx` files, all at segment roots (`app/app/`, `app/coach/`, `app/admin/`).
`Suspense` appears nowhere in the signed-in tree — only in `app/page.tsx`, `app/coaches/`,
`app/locations/`, `app/login/`, `app/signup/`.

So navigating to `/admin/schedule` or `/coach/players/[id]` shows the **old** page until the
entire server render finishes. This is what makes it feel broken rather than merely slow.

---

## Step 1 — Stream every protected route

Biggest *perceived* win. Doesn't reduce total time; removes the frozen-page effect, which
is the actual complaint. No prerequisites.

- Add a `loading.tsx` to each protected segment that lacks one. Reuse the skeletons already
  in `app/app/loading.tsx` / `app/coach/loading.tsx` / `app/admin/loading.tsx`; extract a
  shared skeleton if they diverge.
- Wrap the slow data region of each page in `<Suspense>` so static chrome (nav, header,
  rail) paints immediately and data streams in.
- Priority order — highest-traffic and slowest first:
  1. `app/app/page.tsx`, `app/app/schedule/page.tsx`, `app/app/book/page.tsx`
  2. `app/coach/page.tsx`, `app/coach/calendar/page.tsx`, `app/coach/players/[playerId]/page.tsx`
  3. `app/admin/schedule/page.tsx`, `app/admin/calendar/page.tsx`, `app/admin/billing/page.tsx`
  4. Remaining `/admin/*` and `/app/*` routes
- **Mandatory case:** `app/app/book/private/page.tsx` depends on `rank_coaches` (~1330ms,
  see Step 7). A Suspense boundary around the coach list is required, not optional.

**Must land with Step 3** — see the trap noted there: adding `loading.tsx` silently moves a
route's prefetch into the `staleTimes.dynamic` bucket, which defaults to **0 seconds**.

**Done when:** every route under `/app`, `/coach`, `/admin` paints chrome within one frame
of the click. Verify by extending an `e2e/flows/` spec per the `AGENTS.md` conventions.

---

## Step 2 — Eliminate the duplicate auth round trips

Biggest *real* win: removes 2 of the 4 round trips (~300ms per navigation from India).

### Prerequisite — DONE (verified 2026-07-29). Nothing outstanding.

Project `jkjgdpifimvnptpxjixk` is on **asymmetric ES256 (P-256)** signing. Verified against
the live endpoint `https://jkjgdpifimvnptpxjixk.supabase.co/auth/v1/.well-known/jwks.json`,
which publishes two ES256 keys and no HS256:

- `kid 5626253a-9e6d-436a-b43f-3f96775ada27` — **current**, signs new tokens
- `kid 75119a57-c4f9-42b1-b1d8-08de7c639819` — previously used; still published so tokens
  issued before the rotation keep verifying until they expire

Because the signing key is asymmetric and its public half is served from a public JWKS
endpoint, the server can fetch it once, cache it, and verify tokens **locally** — which is
what `getClaims()` does and what `getUser()` cannot.

### Implementation

- Swap `supabase.auth.getUser()` → `supabase.auth.getClaims()` in `proxy.ts:44` and
  `lib/auth.ts:15`. `auth-js` 2.110 already ships it (`GoTrueClient.js:5169`) — no
  dependency bump.
- Pass the proxy's verified identity down to the render instead of re-deriving it: set user
  id and role as request headers on the `NextResponse.next({ request })` in `proxy.ts`, and
  have `requireUser` read them via `headers()`. Kills round trip #3, and #4 wherever the
  role is all the page needs.
- Keep the full `profiles` select where the page genuinely needs profile fields
  (`onboarded_at`, `approval_status`, address, billing ids — `lib/auth.ts:84-103`). The
  **role check alone** must stop requiring it.

### Two traps — read before implementing

1. **Session refresh must survive.** `proxy.ts`'s comment (lines 90–94) is correct and
   load-bearing: the proxy runs everywhere so refreshed cookies get persisted, because a
   Server Component can't write cookies. Skipping that rotates the refresh token into an
   invalid state and **signs users out**. Verified safe: `getClaims()` with no argument
   calls `getSession()` internally (`GoTrueClient.js:5173`), which still refreshes an
   expiring token, and the existing `setAll` cookie writer still persists it. The swap
   preserves refresh — but any future "optimisation" that skips the proxy does not.
2. **Silent fallback to the network.** `getClaims()` reverts to a full `getUser()` call if
   the token's alg is `HS*`, has no `kid`, or WebCrypto is unavailable
   (`GoTrueClient.js:5190-5195`). None apply here (ES256 + `kid` + Node WebCrypto), but it
   fails *quietly* — you'd get zero speedup and no error. Assert the fast path in a test or
   check Vercel runtime logs for unexpected auth calls.

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
immediately and re-fetched on every navigation — Step 1's benefit partly evaporates.

Add to `next.config.ts`:

```ts
experimental: {
  staleTimes: { dynamic: 30, static: 180 },
}
```

`dynamic: 30` means re-visiting a route within 30s reuses the cached shell — instant
back/forward and instant tab-switching around `/admin/*`. Still flagged `experimental` in
Next 16.2.10, so pin awareness of it at upgrade time.

**Caveat:** 30s of staleness on dashboard data. If a screen must always be fresh after a
mutation, the fix is `revalidatePath`/`revalidateTag` in the server action — not lowering
this globally. Note that `revalidateTag(tag, profile)` requires the 2nd arg in Next 16
(use `"max"`).

---

## Step 4 — Stop public routes paying the auth tax

`proxy.ts` calls `getUser()` at line 44 and only *then* checks whether the path is protected
at line 47. Every marketing page, every static route, every asset that slips the matcher
pays a **full Tokyo auth round trip before serving cached HTML**. This partly negates the
static/ISR work from `bad4852`.

The naive fix — early-return for non-protected paths before the auth call — is **wrong**:
it reintroduces trap #1 above (lost cookie refresh → silent logouts). Do it properly:

- Land Step 2 first. Once `getClaims()` verifies locally, the cost on public routes drops to
  microseconds on its own and this step is mostly self-solving.
- Then tighten the matcher (`proxy.ts:95-97`) to also exclude routes that can never carry a
  session-refresh obligation, if any remain after measuring. Measure before cutting.
- Do **not** skip the profile query reordering: move the `from("profiles")` call at
  `proxy.ts:60` after the `wanted` check so public routes never hit PostgREST. That one is
  unambiguously safe — it has nothing to do with cookie refresh.

---

## Step 5 — Collapse sequential query stages

Modest but cheap: each collapsed stage is one fewer ~150ms round trip.

Audited: **no N+1 loops** — the `.in()` batching in `app/admin/weekly/page.tsx` is already
correct. The issue is independent queries awaited in series.

- `app/admin/weekly/page.tsx` — the bookings query (line 115) and the series-bookings query
  (line 177) are **independent** of each other: 115 needs `nextByClass`, 177 needs `series`
  from the `Promise.all` at line 36. They can run concurrently. One round trip saved.
- `app/app/page.tsx` — `getMasteryMap` (line 29) depends on the `Promise.all` at line 19, so
  it's a genuine dependency. Not fixable by reordering; fix by pushing it behind a Suspense
  boundary in Step 1, or by having the DB return both in one call.
- Re-audit the other multi-await pages the same way: `app/admin/players/page.tsx`,
  `app/coach/session/[id]/page.tsx`, `app/coach/players/[playerId]/page.tsx`,
  `app/coach/page.tsx`, `app/app/players/[playerId]/page.tsx`, `app/admin/schedule/page.tsx`.

Rule of thumb: an `await` whose inputs were all available before the previous `await`
belongs in the previous `Promise.all`.

---

## Step 6 — Trim what crosses the wire (lowest priority)

Only worth doing after 1–5 are measured; listed so it isn't forgotten.

- **`select("*")`** appears 6× across `app/`, `components/`, `lib/` — including
  `lib/auth.ts:52`, which runs on every protected navigation. Narrow to the columns actually
  read. Small per-row win, but it's on the hottest path in the app.
- **Client-component ratio:** 72 of 152 `.tsx` files under `app/` + `components/` carry
  `"use client"`. That's hydration and JS-parse cost on every navigation, on mid-range
  Android over Indian mobile networks. Audit the largest ones for whether they need to be
  client at all, or whether the client part can be pushed to a leaf island (the pattern
  already used for `StageHeader`/`AuthCta`).
- **Already good, don't regress:** `mapbox-gl` is correctly lazy-imported in
  `components/app/LocationPinMap.tsx:47` and `components/marketing/VenueMap.tsx:47`. It is
  the heaviest dependency in `package.json`; keep it behind `await import()`.

---

## Step 7 — `rank_coaches` (separate issue)

~1330ms and genuinely database-bound, unlike everything above. Step 1 hides it behind a
Suspense boundary; it still deserves its own optimisation pass (index review, or splitting
the ranking from the availability scan).

Per `AGENTS.md`, any change to it must run `npm run test:db` and update the affected
`tests/db/` specs **in the same commit**.

---

## Sequencing

Steps 1 and 2 are independent and both unblocked; no human or dashboard action is
outstanding.

1. **Step 1** + **Step 3** together — perceived-speed win; Step 3 must accompany Step 1 or
   Step 1 underdelivers.
2. **Step 2** — the real ~300ms saving.
3. **Step 4** — largely falls out of Step 2; do the safe query reorder regardless.
4. Re-measure in Vercel runtime logs.
5. **Steps 5–7** only if the numbers still warrant it.
