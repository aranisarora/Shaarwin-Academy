# Coach app: mobile polish plan

Status: planned, not implemented. Execute **after** `docs/fixes-and-cleanup-plan.md`.
Written against commit `98543fb`. Decision-complete: follow as written. Read every named file in full before editing it; read `AGENTS.md` first (this Next.js version differs from your training data — copy in-repo patterns).

**Scope guard: presentation only.** No database, server-action-signature, or route changes. The shared primitives from the admin rework (`components/ui/FilterBar.tsx`, `ActionSection`, `Fab`) already exist — reuse, don't rebuild.

## Who the coach is on this screen

A coach opens the app in three moments, always on a phone, often with one hand:

1. **Morning / commuting** — "where am I today, and when?" (Schedule)
2. **Arriving at the venue** — one tap: "I've arrived." (Session page, top)
3. **During/right after class** — mark who showed up, jot a note, move on. (Session page, roster)

Everything below optimizes those three moments. Nothing else matters to a coach mid-day.

## What's already right (verified — do not touch)

- `CoachShell` — 3-tab bottom bar (Schedule / Players / More). Correct.
- `app/coach/page.tsx` — day-grouped list, live/next session featured with ember frame, live session **auto-opens** via `AutoOpenSession`, travel-gap markers, `NavigateButton` on every card. The core design is right.
- `SessionArrival` — confirm → arrive → late, optimistic UI, big buttons, collapses to a quiet ✓ card once arrived. Correct.
- `SessionRoster` attendance toggles — 44px (`h-11`), colour-coded, optimistic. Correct.

## Phase 1 — Schedule: compress 28 days into one screen

`app/coach/page.tsx` renders every session of the next 4 weeks fully expanded — a very long scroll to answer "what's on today".

1. **Today stays fully expanded** (with its featured card), exactly as now.
2. **Every other day collapses to a header row** on mobile (`lg:` keeps all expanded — desktop has room): day name + session count + first-session time, e.g. `Tomorrow · 3 sessions · from 4:00 pm`. Tapping expands that day inline (client component with `useState`; day sections become a small client wrapper — keep session fetching in the server component and pass rows down as props).
3. Use relative labels where they help: `Today`, `Tomorrow`, then the existing `Friday 31 July` format.
4. Keep the travel-gap markers and completed-session dimming inside expanded days unchanged.

## Phase 2 — Session page: match the task to the moment

`app/coach/session/[id]/page.tsx` + `components/app/SessionRoster.tsx`

1. **"Mark all present" bulk action.** The common case is everyone showed up (the WhatsApp flow already has exactly this: `AC_PRESENT` marks all confirmed → attended). Add a ghost button above the roster list, visible only while `attendanceOpen` and while ≥2 rows still have status `confirmed`: `✓ All present`. Implementation: loop the existing `setAttendance` server action per confirmed booking (sequentially, then one revalidate — read the action first; do NOT write a new server action or RPC). Optimistically flip all rows; per-row toggles still work to undo individuals.
2. **Replace `window.confirm` in "Can't make it"** (`SessionRoster.tsx` ~line 258) with an inline two-step: first tap swaps the button row for `Can't make it? We'll find cover automatically. [Yes, find cover] [Back]`. Native confirm dialogs look broken in a PWA. Same pattern the admin session sheet uses after the admin rework — find and copy it (`AdminSessionSheet.tsx`).
3. **Autosave trust.** Session notes autosave silently; coaches can't tell if it worked. Add a tiny status line under the textarea: `Saving…` while the debounced save is in flight, `Saved ✓` on success (reuse the existing `pending` transition state; add a `saved` boolean reset on next edit).
4. **Post-attendance nudge.** After any player is marked present, show one quiet line under the roster (not a modal): `Add a quick skills note for today? → Assessments` linking to the existing assess flow (`app/coach/skills` / `assess-actions.ts` — read to find the right href). The WhatsApp reply already does this; the app should match.

## Phase 3 — Small screens polish

1. `app/coach/players/page.tsx` (87 lines — read it): if it renders a flat list, add the same search input pattern the admin Players page uses when the list exceeds ~10; one line per row, details in the player page, not the row.
2. Viewport test pass for **all coach screens** at 360×740 and 390×844 portrait (Playwright screenshots): no horizontal scroll, first real content above the fold, tap targets ≥44px. This also discharges the leftover Phase-4 test-pass debt from the (now deleted) admin mobile plan for the coach surfaces.

## Sequencing

| Phase | Size |
|---|---|
| 1 | ~½ session |
| 2 | ~1 session |
| 3 | ~½ session |

Each phase ships independently. `npm run lint` + `npm run build` after each; commit per phase.
