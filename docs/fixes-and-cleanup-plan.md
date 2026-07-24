# Fixes & cleanup — implementation plan

Status: planned, not implemented. **Execute this plan first**, before `docs/coach-mobile-plan.md` and `docs/client-mobile-plan.md` — it contains two live production bugs.
Written against commit `98543fb` on `main`. This document is decision-complete: follow it as written, in order. Every root cause below has already been verified by reading the code — do not re-diagnose, but DO re-read each named file before editing it.

Rules for the executor:

- Read `AGENTS.md` first. This Next.js version has breaking changes vs. your training data — copy in-repo patterns, never write API usage from memory.
- Read `supabase/schema.sql` before writing any query. Do not guess column names.
- Only Part 2 touches the `notify` edge function (redeploy via Supabase MCP after editing). **No database migrations anywhere in this plan.**
- After each part: `npm run lint` and `npm run build` must pass. Commit each part separately with the message given.

---

## Part 1 — P0: infinite redirect loop for new signups

**Symptom:** a new (pending-approval) user opening the app sees the site refresh/redirect forever.

**Verified root cause** (`lib/auth.ts`, `requireUser`): a brand-new self-signup is both *not approved* AND *not onboarded*. The two gates ping-pong:

1. `/app/pending` → approval gate skipped (path exempt) → **onboarding gate fires** (`onboarded_at` null) → redirect `/app/onboarding`.
2. `/app/onboarding` → **approval gate fires** (not approved) → redirect `/app/pending`. → goto 1.

**Fix — one condition.** In `lib/auth.ts` (~line 105), the onboarding gate must only apply to **approved** clients:

```ts
  if (
    p.role === "client" &&
    p.approval_status === "approved" &&   // ← add this line (pending/denied users stay on /app/pending)
    !p.onboarded_at &&
    nextPath.startsWith("/app") &&
    nextPath !== "/app/onboarding"
  ) {
    redirect("/app/onboarding");
  }
```

Nothing else in `requireUser` changes. Do not touch the approval gate above it, the pending page, or `PendingFlow.tsx` — they are correct.

**Verify** (all three, in the running app or by tracing the branch logic in writing):
- Pending client → every `/app/*` path lands on `/app/pending` and **stays** there (no loop).
- Approved but un-onboarded client → lands on `/app/onboarding` as before.
- Approved + onboarded client → untouched.

Commit: `fix(auth): pending users no longer ping-pong between pending and onboarding gates`

## Part 2 — P0: false "coach hasn't arrived" WhatsApp escalation

**Symptom:** coach taps "I've arrived" but the founder still gets the "hasn't marked they've arrived" WhatsApp.

**Verified root cause** (`supabase/functions/notify/index.ts`, `sweepFounderEscalations`, ~line 334): the write paths are all correct (in-app `markArrived` and the WhatsApp button both call `coach_mark_arrival`, which sets `class_sessions.coach_arrived_at`; the webhook runs an impersonated user client so `auth.uid()` is valid). The bug is a **race with zero grace period**: the cron runs **every minute**, and the `notArrived` query fires the moment `starts_at <= now()`. A coach who taps "I've arrived" even 60 seconds after start loses the race, and the once-per-session dedupe means the escalation is never retracted.

**Fix — add a 10-minute grace window.** In the `notArrived` query, change the time bounds only:

```ts
  // Bounded to the last hour so we never backfill old sessions. 10-minute
  // grace: coaches typically tap "arrived" right around start time — only
  // escalate when the class is 10+ minutes in with still no arrival mark.
  const { data: notArrived } = await supabase
    .from("class_sessions")
    .select("id,starts_at,coach_id,classes!inner(title)")
    .eq("status", "scheduled")
    .not("coach_id", "is", null)
    .is("coach_arrived_at", null)
    .lte("starts_at", new Date(now - 10 * 60000).toISOString())   // was: new Date(now)
    .gt("starts_at", new Date(now - 70 * 60000).toISOString())    // was: now - 60 * 60000
    .limit(50);
```

Also update the escalation body copy (same function, the `ops_coach_not_arrived` call) to match reality: `` `${title} (${when}) started over 10 minutes ago and ${name} hasn't marked they've arrived. Worth a quick check-in.` ``

Do not change `sweepBeforeClass`, the `unconfirmed` escalation, or `coach_mark_arrival` (DB) — they are correct.

**Deploy:** redeploy the `notify` edge function via Supabase MCP (`deploy_edge_function`, project ref `jkjgdpifimvnptpxjixk`). Confirm deploy success in the tool result.

Commit: `fix(notify): 10-min grace before "coach not arrived" founder escalation`

## Part 3 — App icon still shows the old orange ball

**Verified state:** the repo icons are already the real logo (commit `2e48185` replaced them; `public/icon-192/512/maskable.png` and `app/icon.png` all contain the Sharwin logo). The remaining problems are packaging, not assets:

1. **`app/manifest.ts`**: the first icon entry `{ src: "/images/logo.png", sizes: "any", type: "image/png" }` is invalid — `sizes: "any"` is only for SVG, and some launchers pick the first entry. **Delete that entry.** Keep the other three.
2. **Maskable icon is not maskable.** `public/icon-maskable.png` is the logo on a transparent background with no safe zone — Android crops it to a circle and it renders tiny/wrong. Regenerate it: 512×512, **solid `#F4F1EA` background**, logo scaled to ~66% of the canvas, centred. Use a one-off Node script with `sharp` (install as a devDependency if not present; delete the script after, or put it in `scripts/`). Source image: `public/icon-512.png`.
3. **iOS has no home-screen icon.** Add `app/apple-icon.png` (Next.js file convention — it is picked up automatically, no code change): 180×180, same solid-background treatment as the maskable icon.
4. **Stale device cache.** Android/iOS cache installed-PWA icons aggressively. After deploy, the founder must **remove the installed app and re-add it to the home screen**. Record this in the commit message and tell the user — no code can force it.
5. **Verify prod actually serves the new bytes** after deploy: fetch `<prod-url>/icon-192.png` and check `Content-Length` is ~15634 (the new file), not ~3061 (the old ball).

Also: **drop the stale stash** — `git stash drop stash@{0}`. It contains only the same three icon files that commit `2e48185` already landed; it is fully superseded (verified by content).

Commit: `fix(pwa): valid manifest icons, true maskable + apple-touch icon`

## Part 4 — Dead-fallback removal

These fallbacks guard RPCs that **verifiably exist** in `supabase/schema.sql` (checked at `98543fb`: `book_series`, `book_session`, `cancel_booking`, `get_bookable_slots`, `handle_coach_dropout` are all present). Worse than dead code, each one runs on **any** RPC error — so a real failure (full class, no entitlement, network) silently falls into a less-safe JS path that skips the RPC's atomic checks.

Remove these four; in each case the RPC error should instead map to the friendly error copy the function already uses:

| File | Site | Action |
|---|---|---|
| `app/app/book/actions.ts` ~line 90 | "Fallback (RPC not applied yet): book just the immediate session in JS" | Delete the JS booking path; on `book_series` error return the mapped error. Keep the error-code→copy mapping that already exists for the RPC path. |
| `app/app/book/actions.ts` ~line 130 | "Fallback (RPCs not yet applied…): validate in JS" | Same treatment for `book_session`. |
| `app/app/book/actions.ts` ~line 240 | "Fallback path without the RPC" | Same for `cancel_booking`. |
| `app/app/book/private/actions.ts` ~line 47 | "Fallback without the engine RPC: all active coaches' availability…" | Delete; on `get_bookable_slots` error return an empty result + error, never the permissive JS list. |
| `app/coach/session/[id]/actions.ts` `cantMakeIt` | "Engine not applied yet: unassign + alert the founder directly" | Delete the fallback branch; on `handle_coach_dropout` error return `{ ok: false, error: "Couldn't arrange cover — tell the founder directly." }`. Never silently null the coach without the engine's cover search. |

**Read each function in full before editing** — preserve every behaviour of the *RPC* path (revalidatePath calls, return shapes, error copy). Only the `if (error) { …do it in JS… }` branches go.

**Keep (do NOT remove) — these are load-bearing:**
- `lib/auth.ts` profile-provisioning insert (guards the DB-trigger race; the approval plan depends on it not setting `approval_status`).
- `lib/whatsapp/identity.ts` belt-and-braces provisioning (same reason).
- `supabase/functions/notify/index.ts` email-via-Resend fallback (delivers to users with no `wa_links` row).
- The WhatsApp generic-template text fallback (needed until Meta approves templates — Part 5).
- `lib/razorpay.ts` / `PlanPicker` offline-checkout fallback (config guard; keeps dev environments working).
- All React `<Suspense fallback>` usages (not error fallbacks at all).

Verify: `npm run build`, then one real round-trip in dev — book a group session, cancel it.

Commit: `refactor: remove dead pre-RPC fallback paths from booking and coach actions`

## Part 5 — Twilio template verification (mostly manual, founder does this)

Secrets and API keys are set (per the founder). What's likely outstanding is **Meta approval of the content templates** — until each template is approved, WhatsApp buttons silently degrade to the plain-text fallback.

1. Executor: read `scripts/whatsapp/provision-templates.mjs` and check whether it has a status/list mode; if yes, run it and report each template's approval status. If not, this is fully manual.
2. Founder (manual): Twilio Console → Content Template Builder → check every template in the registry (all 8+, including `founder_signup_request` and `client_signup_approved`) shows **Approved**, not Pending/Rejected. Rejected ones need copy tweaks + resubmission.
3. Founder (manual): confirm the env keys for every template SID are set as Supabase function secrets (the registry table in `docs/whatsapp-interactive.md` lists the env key names), then redeploy `notify` once.
4. Live round-trip on a real phone (from the old approval plan): throwaway Google account → request access → founder gets Approve/Deny buttons → tap Approve → applicant receives the CTA → lands in onboarding with phone pre-filled. **This also regression-tests Part 1.**

Nothing to commit unless step 1 reveals a script fix.

---

## Execution order & sizing

| Part | What | Size |
|---|---|---|
| 1 | Auth loop fix | ~5 min |
| 2 | Escalation grace + notify deploy | ~15 min |
| 3 | Icons + manifest + stash drop | ~30 min |
| 4 | Fallback removal | ~1 h |
| 5 | Twilio verification | manual |

Parts 1–2 ship together the same day — both are live bugs.
