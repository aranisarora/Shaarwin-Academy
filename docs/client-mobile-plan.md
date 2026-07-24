# Client app: mobile polish plan

Status: planned, not implemented. Execute **after** `docs/fixes-and-cleanup-plan.md` (and ideally after `docs/coach-mobile-plan.md`, but they are independent).
Written against commit `98543fb`. Decision-complete: follow as written. Read every named file in full before editing; read `AGENTS.md` first (this Next.js version differs from your training data — copy in-repo patterns).

**Scope guard: presentation only.** No database, server-action-signature, or route changes. Reuse the existing shared primitives (`components/ui/FilterBar.tsx`, `Sheet`, `ActionSection` from the admin rework) — do not rebuild them.

## Who the client is on this screen

A parent, on a phone, usually in one of four moments:

1. **"When's the next class, and where?"** — the single most common open. (Home)
2. **"Book something"** — a group slot for their kid, or a private lesson. (Book)
3. **"We can't make Tuesday"** — cancel or reschedule. (Schedule)
4. **"Is my kid improving? / What am I paying?"** — occasional. (Players, Membership)

## What's already right (verified — do not touch)

- `ClientShell` — 5-tab mobile bar (Home / Players / Book / Schedule / More), desktop rail with per-player shortcuts. Correct.
- `app/app/page.tsx` Home — next-session hero card, player cards with mastery, two big book buttons, trial banner. The shape is right; only tweaks below.
- `ScheduleList` — upcoming/past tabs, card → sheet, lazy-loaded `RescheduleSheet`. Correct structure.

## Phase 1 — Book: the tab that hides half of booking

`app/app/book/page.tsx`, `components/app/BookBrowser.tsx` (465 lines — read fully first)

**Problem 1: private booking is unreachable from the tab bar.** The mobile "Book" tab opens group booking only; "Book private class" exists only as a Home button and a desktop rail item. A parent on the Book tab looking for a private lesson finds nothing.

1. Add a compact **segmented toggle** at the top of both `/app/book` and `/app/book/private` (mobile and desktop): two links styled as a pill switch — `Group classes | Private coaching` — highlighting the current page. Pure `<Link>`s, no state; put the small shared component in `components/app/BookModeSwitch.tsx`.

**Problem 2: controls before content.** `BookBrowser` opens with two `<Select>`s (Level, Day) and always renders a 42vh `VenueMap` before the slot list.

2. Replace the two Selects with **`FilterBar` chips** (`All levels ▾` `Any day ▾`) — same component and behaviour as the admin screens. Desktop keeps inline selects if `FilterBar` already handles that split (it does — verify its props).
3. **Collapse the map behind a chip on mobile**: a `Map ▾` chip at the end of the filter row toggles the `VenueMap`; default hidden on <1024px, always visible on desktop. The slot list becomes the first content on screen.
4. **Booking sheet** (opens per slot, ~line 262): apply glance-then-act — facts first (day/time, venue, level, price/entitlement line), then the player picker, then one primary CTA. If the household has ≤4 players render the picker as tappable chips instead of a `<Select>`; 5+ keeps the select. Keep every entitlement/trial branch exactly as coded — the logic is subtle (trial vs plan vs drop-in); change only layout.

## Phase 2 — Schedule: cancel/reschedule without fear

`components/app/ScheduleList.tsx` (226 lines — read fully first)

1. The booking sheet's actions: make destructive flows two-step **inside the sheet** (`Cancel this class` → `You'll free the spot for someone else. [Yes, cancel] [Keep it]`). If any `window.confirm` remains, remove it (same principle as the coach/admin plans).
2. One line per card: keep as is (already compliant — date+class+venue, badges right).
3. Weekly-series rows: the sheet must make scope obvious before acting — reuse the copy pattern the reschedule flow already has ("just this session / every week") if present; verify against the actual sheet code, and mirror the admin session sheet's wording.

## Phase 3 — Home & Membership tweaks

1. Home next-session card: promote `Manage booking` from a text link to a secondary `Button` (`ButtonLink variant="ghost"`) — it's the #3 action in the app and currently the least tappable thing on the page.
2. Home: when there is no upcoming session but an active plan, the EmptyState copy should point at the Book tab: `Nothing booked. The table's free — book a class.` with the existing book buttons directly beneath (reorder so the buttons sit right under the EmptyState in that branch).
3. `app/app/membership/page.tsx` (232 lines — read first): single-column plan cards on mobile with the current-plan card first; the primary CTA (`Upgrade` / `Manage`) visible without scrolling past all tiers. Keep the offline/WhatsApp checkout fallback branch untouched.
4. Any explainer paragraphs on client pages follow the established rule: desktop-only (`hidden lg:block`) or moved into the relevant sheet.

## Phase 4 — Viewport test pass

All client screens (Home, Book group, Book private, Schedule, Players, player detail, Membership, More, Onboarding, Pending) at 360×740 and 390×844 portrait via Playwright screenshots: no horizontal scroll, first real content above the fold, tap targets ≥44px. This completes the outstanding viewport-audit debt for the client surfaces.

## Sequencing

| Phase | Size |
|---|---|
| 1 | ~1 session |
| 2 | ~½ session |
| 3 | ~½ session |
| 4 | ~½ session |

Each phase ships independently. `npm run lint` + `npm run build` after each; commit per phase. One manual round-trip after Phase 1: book a group slot end-to-end in dev, then cancel it from Schedule after Phase 2.
