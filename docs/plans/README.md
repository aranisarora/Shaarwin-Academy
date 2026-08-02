# Plans index

Active, execution-ready plans live here. A plan leaves this folder when it
ships — the commit history is the record, so a finished plan is deleted rather
than left behind marked COMPLETE.

| Plan | Status | What it delivers |
| --- | --- | --- |
| [instant-navigation.md](instant-navigation.md) | **Phases A + B shipped**; **Phase D needs the owner** | Shell paints before auth resolves on the streamable protected routes |

Notification and WhatsApp work is no longer tracked here — it lives in
[`../notifications.md`](../notifications.md) (§4 is the open list).

**Everything lands on `main`.** The old `chore/cleanup-and-perf` branch is gone:
its commits were merged and the branch deleted. Any doc still telling you to
work there is out of date.

**Phase D is the one thing blocking progress, and only the owner can unblock
it.** None of this work has been measured against real latency. `npm run
e2e:flows` refuses to start while a dev server is up, and must not be pointed at
the one on :3000 — that database is live. Stop the dev server, then run it.

## Execution order

1. ~~**Phase A**~~ — done (`21ba501`, `ffa3201`). Membership gates moved into the
   proxy, so `requireUser` is a pure read and every shell paints before auth
   resolves.
2. ~~**Phase B**~~ — done (`ab08434`, `e69b9a5`, `4c06af8`). 26 routes stream.
3. **Phase D** — deploy and measure. Next, and needs the owner.
4. **Phase C** (Cache Components + `unstable_instant`) — only if the numbers
   justify a large migration against a draft API. Phase A removed its hard
   prerequisite: no protected page reads cookies outside a `<Suspense>` boundary
   any more.

## House rules (from `AGENTS.md` — non-negotiable)

- This Next.js version has breaking changes; read `node_modules/next/dist/docs/`
  before writing code against an unfamiliar API.
- `supabase/schema.sql` is the canonical schema. Any migration must regenerate it
  via the Supabase MCP and commit it in the same commit (pre-commit hook
  enforces this).
- Any change to a Postgres function runs `npm run test:db` and updates the
  affected `tests/db/` specs in the same commit.

## Where the retired docs went

Deleted once shipped and merged — `git log` is the record:

- **codebase-cleanup** — dead code deleted, duplication collapsed (formatting,
  confirms, phone normalisation), `ui/Switch`/`Checkbox`/`Radio` extracted, and
  the lint rule banning ad-hoc date formatters outside `lib/academy-time.ts`.
- **navigation-performance** — streaming under the shell, `getClaims` instead of
  a network `getUser`, `staleTimes.dynamic`, narrowed profile selects.
- **notification-plan**, **notification-fix-plan**, **notification-fix-status**,
  **notification-fix-owner-actions** — folded into
  [`../notifications.md`](../notifications.md) (what we send, what changed,
  what's still open) and [`../whatsapp-messaging.md`](../whatsapp-messaging.md)
  (how it's delivered — now an audit kept for its reasoning, not a status).
- **school-head-login** — shipped (migrations `0057`–`0058`). A school signs in
  with a shared email+password — the one account type that does, because a
  six-digit code lands in one inbox and several people at a school need in — and
  reads its own campus's pupils through widened RLS, so the parent's insights,
  notes and mastery code serves both audiences unchanged. Read-only in the
  database, not just in the UI. The password grant was verified live against
  prod (a bogus sign-in returns `invalid_credentials`, not a provider-disabled
  error), so nothing is pending on the Supabase side.
- **location-model** — shipped in `1a610ab` (migrations `0052`–`0054`). All 167
  privates carry a `venue_id` and nothing derives a location from an address
  string any more. The durable part is `../notifications.md` §5.

Still live, outside this folder:

- [`archive/private-booking-ux-plan.md`](archive/private-booking-ux-plan.md) —
  shipped in `ba4e5a1`; kept for the design rationale.
- `docs/testing-harness-plan.md` — shipped; stays because `AGENTS.md` links it.
- `docs/blind-user-audit.md` — not a plan; an occasional manual runbook.
