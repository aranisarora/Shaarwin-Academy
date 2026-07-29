# Plans index

Active, execution-ready plans live here. Each is written for an implementing model
(Opus): every claim is verified against the code as of 2026-07-29 unless marked
**Verify**, and each step says how to prove it landed.

| Plan | Status | What it delivers |
| --- | --- | --- |
| [navigation-performance.md](navigation-performance.md) | not started | Instant-feeling navigation in the signed-in app: streaming, router cache, halved auth round trips |
| [codebase-cleanup.md](codebase-cleanup.md) | not started | Dead code deleted, redundant fallbacks removed, formatting/confirm/phone duplication collapsed |

## Execution order

1. **codebase-cleanup Phase 1–2** (dead code + redundant fallbacks) — small, safe,
   shrinks the surface the other plan touches.
2. **navigation-performance Steps 1+3, then 2, then 4** — the user-facing win.
3. **codebase-cleanup Phases 3–5** — correctness fixes, then consolidation, then guards.

The two plans are independent; interleave freely. Where they overlap (`select("*")`
narrowing, client-component audit) the work lives in navigation-performance Step 6 and
codebase-cleanup only cross-references it.

## House rules (from `AGENTS.md` — non-negotiable)

- This Next.js version has breaking changes; read `node_modules/next/dist/docs/` before
  writing code against an unfamiliar API.
- `supabase/schema.sql` is the canonical schema. Any migration must regenerate it via the
  Supabase MCP and commit it in the same commit (pre-commit hook enforces this).
- Any change to a Postgres function runs `npm run test:db` and updates the affected
  `tests/db/` specs in the same commit.

## Archived / shipped

- `archive/private-booking-ux-plan.md` — shipped in `ba4e5a1` (Uber-style address,
  instant slots, day+time picker). Kept for the design rationale.
- `docs/testing-harness-plan.md` — shipped; stays in `docs/` because `AGENTS.md` links to
  it as the harness reference.
- `docs/blind-user-audit.md` — not a plan; an occasional manual runbook. Stays in `docs/`.
- `docs/reuse-audit.md` — **deleted**; fully absorbed into
  [codebase-cleanup.md](codebase-cleanup.md) (evidence line references preserved there).
- `docs/navigation-performance-plan.md` — **deleted**; superseded by
  [navigation-performance.md](navigation-performance.md), which corrects two false claims
  (see its changelog).
