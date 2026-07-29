# Plans index

Active, execution-ready plans live here. Each is written for an implementing model
(Opus): every claim is verified against the code as of 2026-07-29 unless marked
**Verify**, and each step says how to prove it landed.

| Plan | Status | What it delivers |
| --- | --- | --- |
| [instant-navigation.md](instant-navigation.md) | **NOT STARTED — start here** | Finishes the streaming work: shell paints before auth resolves, remaining 31 routes, then measure |
| [navigation-performance.md](navigation-performance.md) | **Steps 1–6 shipped**, 7 out of scope | Streaming, router cache, halved auth round trips |
| [codebase-cleanup.md](codebase-cleanup.md) | **COMPLETE** except `ui/DateInput` | Dead code deleted, redundant fallbacks removed, formatting/confirm/phone duplication collapsed |

All work lands on the branch `chore/cleanup-and-perf`, not `main` — now 28 commits ahead
and **unmerged**, pending the owner's `npm run dev` check.

**Read the execution log at the top of each plan before trusting its body.** Both finished
plans had a load-bearing error that only surfaced during implementation:
`codebase-cleanup.md` has a factually wrong row in its Phase 1.2 table, and
`navigation-performance.md` misdiagnosed the cause of the freeze (a segment-root
`loading.tsx` already covers every child route — the ~30 "missing" ones were never a gap).

## Execution order

1. **instant-navigation.md Phase A** — make the shell paint before `requireUser` resolves.
   This is the actual remaining win, and a hard prerequisite for its Phase C.
2. **Phase B** — the other 31 routes, folding in the Step 5 query re-audit per file.
3. **Phase D** — deploy and measure. Nothing in either performance plan has been validated
   against real latency yet, and `npm run e2e:flows` has never run against this work.
4. **Phase C** (Cache Components + `unstable_instant`) — only if the measurements justify
   a large migration against a draft API. Owner's call, with numbers in hand.

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
- [navigation-performance.md](navigation-performance.md) and
  [codebase-cleanup.md](codebase-cleanup.md) are both **done** but kept in place, not
  archived: their execution logs are the record of what was corrected and what was
  deliberately skipped, and [instant-navigation.md](instant-navigation.md) references
  both.
