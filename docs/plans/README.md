# Plans index

Active, execution-ready plans live here. Each is written for an implementing model
(Opus): every claim is verified against the code as of 2026-07-29 unless marked
**Verify**, and each step says how to prove it landed.

| Plan | Status | What it delivers |
| --- | --- | --- |
| [instant-navigation.md](instant-navigation.md) | **Phases A + B shipped**; **D is next and needs you** | Shell paints before auth resolves on all 26 streamable protected routes |
| [navigation-performance.md](navigation-performance.md) | **Steps 1–6 shipped**, 7 out of scope | Streaming, router cache, halved auth round trips |
| [codebase-cleanup.md](codebase-cleanup.md) | **COMPLETE** except `ui/DateInput` | Dead code deleted, redundant fallbacks removed, formatting/confirm/phone duplication collapsed |

All work lands on the branch `chore/cleanup-and-perf`, not `main` — now 33 commits ahead
and **unmerged**, pending the owner's `npm run dev` check.

**The one thing blocking progress is Phase D, and only the owner can unblock it.**
Nothing in any of these three plans has been measured against real latency. The e2e
flows have still never run against this work, because `npm run e2e:flows` refuses to
start while a dev server is up — and it must not be pointed at the one on :3000, whose
database is live. Stop the dev server, then run it.

**Read the execution log at the top of each plan before trusting its body.** Both finished
plans had a load-bearing error that only surfaced during implementation:
`codebase-cleanup.md` has a factually wrong row in its Phase 1.2 table, and
`navigation-performance.md` misdiagnosed the cause of the freeze (a segment-root
`loading.tsx` already covers every child route — the ~30 "missing" ones were never a gap).

## Execution order

1. ~~**instant-navigation.md Phase A**~~ — done (`21ba501`, `ffa3201`). The membership
   gates moved into the proxy, so `requireUser` is a pure read and every shell paints
   before auth resolves.
2. ~~**Phase B**~~ — done (`ab08434`, `e69b9a5`, `4c06af8`). 26 routes stream; the Step 5
   re-audit is folded in, with three real overlap wins and two non-findings commented
   so they aren't re-audited.
3. **Phase D** — deploy and measure. **This is the next step and it needs the owner**;
   see the note above.
4. **Phase C** (Cache Components + `unstable_instant`) — only if the measurements justify
   a large migration against a draft API. Owner's call, with numbers in hand. Note that
   Phase A has now removed its hard prerequisite: no protected page reads cookies outside
   a `<Suspense>` boundary any more.

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
