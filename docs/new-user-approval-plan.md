# New-user approval rework — implementation plan

Status: planned, not implemented. Execute **after** `docs/skills-rework-plan.md` and `docs/whatsapp-upgrade-plan.md` (this plan assumes the template registry, client button handling, and worker policy map from the WhatsApp plan already exist).
This document is decision-complete: follow it as written. Written against commit `bad4852` on `main`.

## Goal

The academy is closed-membership. Today anyone can sign up and immediately see the full timetable, coach roster and pricing — including competitors. After this rework:

- **New** self-signups authenticate (Google/email) as today, then hit a gate: give us your **name and phone number**, and wait for founder approval.
- The **founder** gets a WhatsApp message with the applicant's name, email and phone, and **Approve / Deny** buttons (plus the same controls in the admin app).
- On **approve**, the applicant gets a WhatsApp message — "you're approved" — with a button that opens the app, and lands straight in the existing onboarding flow (phone step already done).
- On **deny**, nothing is sent. The applicant's pending screen quietly shifts to "contact us" copy. We don't tip off competitors.
- **Existing clients are never touched**: every profile that exists at migration time is backfilled as approved, and founder-invited clients (`client_invites`) auto-approve on claim.

## Read first (non-negotiable)

- `AGENTS.md`: this Next.js version has breaking changes vs. training data. Copy existing in-repo patterns (server components + `requireUser`, `"use server"` action files) rather than writing from memory.
- `supabase/schema.sql` is the canonical schema — re-verify every column/function named below before writing SQL. Pay attention to `handle_new_user`, `claim_client_invite`, `notify_founders`, `wa_links`, and the RLS policies on reference tables.
- DB changes via Supabase MCP `apply_migration` (project ref `jkjgdpifimvnptpxjixk`), regenerate `supabase/schema.sql` via MCP, commit together (pre-commit hook enforces this). The WhatsApp plan starts at `0036` — check `supabase/migrations/` for the **next free number** (likely `0037`).
- Read `lib/whatsapp/interactive.ts` and `supabase/functions/notify/index.ts` as they exist **after** the WhatsApp rework — this plan adds one founder button pair and two templates to machinery that plan builds. Deploy the `notify` edge function via MCP after editing it.

## Current state (verified at `bad4852`)

- Signup: `app/signup/page.tsx` → `AuthForm` (Google OAuth via `app/auth/callback/route.ts`, or email). The DB trigger `handle_new_user` creates the `profiles` row (`role='client'`) + a seed `players` row at auth-user creation; `requireUser` (`lib/auth.ts`) has a belt-and-braces fallback that does the same.
- Gating today: `requireUser` redirects un-onboarded clients to `/app/onboarding`; nothing else. Any authenticated client can browse `/app` surfaces and query client-readable tables.
- `profiles.phone` is **unique** and is the WhatsApp identity. Onboarding step 2 (`app/app/onboarding/actions.ts` → `savePhone`) normalizes via `normalizePhoneInput` (`lib/whatsapp/phone.ts`), checks uniqueness, updates `profiles.phone` (which fires the `claim_client_invite` trigger for founder-pre-created invites), and calls `linkPhoneToUser` to upsert `wa_links`.
- The notify worker delivers WhatsApp **only** to users with a `wa_links` row (`deliverWhatsApp` looks up `wa_links` by `user_id`); otherwise falls back to email. This is why approval-time linking (below) matters — it's what lets the "you're approved" message reach a user who has never messaged the bot.
- `ops_notify_new_profile` trigger already fires `ops_new_client` to founders on profile insert (feed-only after the WhatsApp plan's Part 1).
- Founder contact fallback for humans: `lib/contact.ts` exports `WHATSAPP_NUMBER`.

## Design decisions (locked)

- **State model**: one enum column `profiles.approval_status`: `pending | approved | denied`. Existing rows backfill to `approved`. No separate timestamps table; the founder notification row is the audit trail.
- **The gate lives in `requireUser`** — the single choke point every `/app` page already goes through. Plus RLS hardening (Part 5) so a pending user with a JS console can't read the timetable either.
- **Phone is captured pre-approval** (it's the approval-request payload *and* the delivery address for the approval message), reusing the exact `savePhone` machinery. The onboarding phone step then auto-skips via its existing pre-set-phone fast-path.
- **`wa_links` is created at approval time, not at request time** — a pending (possibly hostile) user must not be able to talk to the assistant as a recognized client.
- **Silent deny.** No message to denied users. Their pending screen becomes neutral "we couldn't verify your request — message us" copy with the `WHATSAPP_NUMBER` link. Deny is reversible: the founder can still approve later from the admin list.
- Both new WhatsApp templates are **UTILITY** (cost model in the WhatsApp plan holds; volume here is a handful/month — cost is irrelevant, the templates exist because both messages are business-initiated outside any service window).
- Approvals are **idempotent**: double-tap or admin+WA race resolves to "already handled".

---

## Part 1 — Database migration

`supabase/migrations/00XX_signup_approval.sql` (next free number), applied via MCP. Contents (adapt names to `schema.sql` — verify `notify_founders` signature, `wa_links` PK, `is_founder()` before writing):

1. **Enum + column**

```sql
create type public.signup_approval_status as enum ('pending', 'approved', 'denied');

-- Default 'approved' so every existing row (and any concurrent insert during
-- the deploy) is grandfathered in; flip the default to 'pending' immediately
-- after. handle_new_user sets it explicitly from then on.
alter table public.profiles
  add column approval_status public.signup_approval_status not null default 'approved';
alter table public.profiles
  alter column approval_status set default 'pending';
```

2. **`handle_new_user`**: in the coach-invite branch, insert with `approval_status = 'approved'`. In the client branch, insert with `'pending'` (the new default covers it, but be explicit). Everything else unchanged.

3. **`claim_client_invite`**: when an invite is claimed, also `set approval_status = 'approved'` on the profile (founder-invited clients never see the gate). Check whether this trigger runs `before update` and mutates `new` vs. writes separately — follow whichever it does today.

4. **Staff-created accounts**: grep `lib/admin-ops-clients.ts` / any admin action that inserts `profiles` or `client_invites` rows directly and make sure resulting profiles end up `approved` (explicit column in the insert, or rely on the invite-claim path — verify which path each uses).

5. **RPC `submit_signup_request()`** — `security definer`, `set search_path to 'public'`:
   - Guard: caller is authenticated, own profile has `role = 'client'` and `approval_status = 'pending'`.
   - Takes `p_name text, p_phone text` (already E.164-normalized by the server action).
   - Updates `profiles.full_name` and `profiles.phone` (unique violation → return a typed error the action can map to "that number is already registered"). The phone update fires `claim_client_invite`; **re-read `approval_status` after the update** — if it flipped to `approved` (invite matched), return `{ status: 'approved' }` and insert **no** founder notification.
   - If the seed player row still carries the old profile name (same dedupe check `ops_notify_new_player` uses), rename it to the new name too.
   - Otherwise insert the founder notification via `notify_founders('signup_request', 'New signup request', <name (email, phone) wants access.>, jsonb_build_object('client_id', auth.uid(), 'applicant_name', ..., 'applicant_email', ..., 'applicant_phone', ..., 'url', '/admin/clients'))`.
   - Idempotent: if a `pending`-status founder notification of type `signup_request` for this `client_id` already exists (not yet sent), update its body/data in place instead of inserting a second one (lets the user correct a typo'd phone before the founder sees it). If it already went out, insert nothing new — the founder has the buttons.
   - Returns `{ status }` so the client page can render the right state.

6. **RPC `review_signup_request(p_client uuid, p_approve boolean, p_reviewer uuid default auth.uid())`** — `security definer`. This is the **single** approve/deny implementation; the admin action and the WhatsApp button both call it.
   - Guard: `p_reviewer` must be a founder (`select role from profiles where id = p_reviewer`). When called via the app, `p_reviewer = auth.uid()` and additionally require `is_founder()`. (The WhatsApp inbound handler runs on the service client and passes the founder's user id resolved from the notification row — mirror however the coach button handlers execute their writes in `lib/whatsapp/interactive.ts`.)
   - If the target profile is not `pending`: return `{ ok: false, error: 'already_reviewed', status: <current> }` — callers reply "Already handled".
   - **Approve**: set `approval_status = 'approved'`; upsert `wa_links` for the profile's phone (`insert ... on conflict (phone) do update set user_id = excluded.user_id, linked_at = now()` — verify PK; safe because `profiles.phone` uniqueness was enforced at request time); insert the applicant's notification: type `signup_approved`, title `You're approved!`, body `Welcome to Sharwin TTA — tap below to finish setting up your account.`, `data: jsonb_build_object('first_name', <first word of full_name>, 'url', '/app')`.
   - **Deny**: set `approval_status = 'denied'`. No notification, no wa_link.
   - Mark the originating `signup_request` notification as read (`read_at = now()`) so the admin pending list and feed stay tidy.

After applying: regenerate `supabase/schema.sql` via MCP, run MCP `get_advisors` (security) and fix flags, commit migration + schema together.

## Part 2 — Templates (extend the WhatsApp plan's registry)

Add two entries to `TEMPLATES` in `scripts/whatsapp/provision-templates.mjs` (same rules: UTILITY, `language: "en"`, no adjacent variables, no variable at body start/end, no emoji in button titles):

| Env key | friendly_name | Type | Content |
| --- | --- | --- | --- |
| `TWILIO_WA_FOUNDER_SIGNUP_SID` | `founder_signup_request` | quick-reply | Body: `New signup request from {{1}} — email {{2}}, phone {{3}}. Approve access to the academy?` Buttons: `Approve` (id `su_approve`), `Deny` (id `su_deny`) |
| `TWILIO_WA_CLIENT_APPROVED_SID` | `client_signup_approved` | call-to-action | Body: `Great news {{1}} — your Sharwin TTA membership request is approved. Tap below to set up your family and book your first session.` URL button `Open the app` → `{APP_URL}/app` (static) |

Wire both into `interactiveContentFor()` in `supabase/functions/notify/index.ts`, keyed by types `signup_request` (vars from `data.applicant_*`) and `signup_approved` (var from `data.first_name`). Both record `twilio_sid` on the row via the existing shared path — the founder's buttons depend on it. Text fallback (pre-approval of the template) is the existing generic-template path and is acceptable: the founder can always act from `/admin/clients`.

Worker policy: **neither type goes in `FEED_ONLY`**. Quiet hours (WhatsApp plan Part 7): `signup_request` is **never deferred** (the applicant is sitting on the pending screen); `signup_approved` **is deferrable** (nobody onboards at 2am). Add both to the `TRANSACTIONAL` set (bypass prefs) — check where that set lives in the worker.

## Part 3 — Signup & pending UX

### 3a. `requireUser` gate (`lib/auth.ts`)

After the profile fetch/provision, add (before the onboarding redirect):

- If `p.role === "client"` and `p.approval_status !== "approved"` and `nextPath.startsWith("/app")` and `nextPath !== "/app/pending"` → `redirect("/app/pending")`.
- If approved and `nextPath === "/app/pending"` → `redirect("/app")` (handled in the page itself, same as onboarding does).
- Add `approval_status` to the `Profile` type. The belt-and-braces provisioning insert in `requireUser` must not set it (let the DB default `'pending'` apply — that insert only fires for brand-new users).

Coaches and founders are untouched by all branches.

### 3b. Pending page (`app/app/pending/page.tsx` + `actions.ts` + client component)

Server component, `requireUser("/app/pending")`; redirect to `/app` if not a pending/denied client. One page, three states driven by the profile:

1. **Request form** (`approval_status = 'pending'` and no `phone` yet): heading like "One quick step", copy explaining the academy verifies new members personally, inputs for full name (prefill `profile.full_name`) and phone (placeholder `+91 …`). Submit → server action: `normalizePhoneInput` (reuse `savePhone`'s validation + error copy exactly), then `supabase.rpc("submit_signup_request", …)`, map errors (`phone_taken` → the same "already registered — log in instead?" style message `savePhone` uses). On `{ status: 'approved' }` (invite auto-claim) `redirect("/app")`.
2. **Waiting** (`pending` with phone set): "Request sent — we'll WhatsApp you at {phone} once you're approved." Small "wrong number?" link that re-shows the form (resubmitting is safe; the RPC updates in place). Mount a tiny client component that calls `router.refresh()` every ~10s — when the founder approves, the next refresh hits `requireUser`'s approved branch and the page redirects into the app. No realtime subscription; this page is short-lived and rarely open.
3. **Denied**: neutral copy — "We couldn't verify your request just now. If you think that's a mistake, message us." with a `wa.me/${WHATSAPP_NUMBER}` link (`lib/contact.ts`). No "denied" wording. No form.

Style it like the onboarding screens (`app/app/onboarding/page.tsx`'s centered `max-w-md` layout), not the marketing `StageShell`.

### 3c. Signup page copy (`app/signup/page.tsx`)

Adjust the copy to set expectations: keep the headline, change the sub-line to something like "New here? Sign up and request access — we personally approve every new family." Do not add friction before auth; the gate is after login by design (we want their verified email).

## Part 4 — Founder surfaces

### 4a. WhatsApp Approve/Deny buttons (`lib/whatsapp/interactive.ts` + `app/api/whatsapp/route.ts`)

Extend the founder-capable path built in the WhatsApp plan (client buttons land in Part 5 there; this adds a founder pair):

- Add `su_approve` / `su_deny` to `WA_BUTTON`. **Real taps only** (payload id or exact button title), founder role only; typed text still falls through to the assistant.
- Resolve context via `originalSid` → notification row (type `signup_request`) → `data.client_id`; the row's `user_id` is the acting founder — pass it as `p_reviewer`. If the row can't be found, reply with a deep link to `/admin/clients`.
- Call `review_signup_request` exactly as the admin action does (same RPC, per Part 1 — follow the existing coach-button execution pattern for how the service client invokes it).
- Replies: approve → `Approved ✅ — {name} has been sent the onboarding link.`; deny → `Denied — they won't be notified.`; `already_reviewed` → `Already handled.` Log to `wa_messages` identically to the other buttons.

### 4b. Admin app (`app/admin/clients/page.tsx`)

- Add a "Pending requests" section at the top of the clients page (only rendered when non-empty): fetch profiles `where role = 'client' and approval_status = 'pending' and phone is not null` (phone-null pendings haven't submitted the form yet — list them separately as "signed up, hasn't requested access" with no actions, or omit; keep it simple and omit). Each row: name, email, phone, requested-at, **Approve** / **Deny** buttons.
- Server actions in the clients page's actions file (or a new one following local convention): call `supabase.rpc("review_signup_request", { p_client, p_approve })` as the signed-in founder, `revalidatePath("/admin/clients")`.
- Also surface **denied** clients somewhere findable (a filter or a small collapsed list) with a "Approve anyway" action — deny must be reversible without SQL.
- Check how `app/admin/clients/page.tsx` currently lists clients and whether pending/denied profiles would confusingly appear in the main list — if so, badge them (`Badge` component) rather than hiding them.

## Part 5 — RLS hardening (the actual gatekeeping)

Page redirects stop casual browsing; a competitor with the anon key + their session token can still query client-readable tables directly. Close that:

- New helper `public.is_approved()` — `security definer`, stable: `select exists(select 1 from profiles where id = auth.uid() and approval_status = 'approved')`. Follow the exact shape of the existing `is_coach()` / `is_founder()` helpers in `schema.sql`.
- Grep `schema.sql` for `create policy` on the reference tables a client can read — at minimum `classes`, `class_sessions`, `coaches`, `venues`, `plans` — and for each **client-facing select policy**, AND in `(select is_approved())` alongside the existing client branch. Leave coach/founder branches untouched. Use the `(select …)` InitPlan form — this repo already did that optimization pass (commit `71ee1cc`); don't regress it.
- **Before touching each policy, check whether the marketing site reads that table** (grep the marketing pages / `lib` for the fetches behind the static pages from commit `bad4852` — "cache reference data + static-render marketing pages"). Tables the public marketing site renders (likely `venues`, possibly `classes`) either already allow `anon` (in which case gating `authenticated` pending users there is pointless — skip them) or are fetched with the service role (safe to tighten). Do not break the static marketing build; `npm run build` after this step is the check.
- Own-row tables (`bookings`, `players`, `subscriptions`, `notifications`, …) are already scoped to the user and need no change — a pending user seeing their own empty rows leaks nothing.
- This lands in the **same migration** as Part 1 (one schema change, one `schema.sql` regen) unless the policy diff gets large — then a second numbered migration immediately after is fine.

## Part 6 — Onboarding adjustments

- The phone step: `savePhone`'s pre-set fast-path (see the comment around `app/app/onboarding/actions.ts:175`) should make step 2 auto-confirm for approved-flow users, since `profiles.phone` is already set. Verify the fast-path also ensures the `wa_links` row (the approval RPC created it, so this is belt-and-braces) and that `OnboardingFlow` renders the step as already-done rather than asking again. Small copy tweak if needed ("We've got your number — {phone}").
- No other onboarding change. The approved user's journey is: WhatsApp button → `/app` → `requireUser` → `/app/onboarding` (players step first) → done, exactly the existing flow.
- `docs/whatsapp-interactive.md` (rewritten in the WhatsApp plan's Part 10): add the two new templates to its registry table and a short "signup approval" section describing the founder buttons.

---

## Execution order & commits

Each step leaves the app buildable and existing users unaffected (everything pre-migration is `approved`).

1. **Migration** (Parts 1 + 5) via MCP + `schema.sql` regen, one commit. From this moment new self-signups are `pending` but there's no UI — do this and step 2 in the same working session.
2. **`requireUser` gate + pending page + signup copy** (Part 3). The gate now works end-to-end with admin-side approval only.
3. **Admin pending list + actions** (Part 4b).
4. **Templates** (Part 2): registry entries + `npm run wa:provision` (manual gate opens; worker falls back to the generic template meanwhile) + worker `interactiveContentFor` wiring + quiet-hours/TRANSACTIONAL sets. Deploy `notify`.
5. **WhatsApp Approve/Deny buttons** (Part 4a).
6. **Onboarding fast-path verification + docs** (Part 6).

## Manual steps (founder/operator)

1. `npm run wa:provision` and watch the two new templates through Meta approval (Twilio Console → Content Template Builder).
2. `supabase secrets set TWILIO_WA_FOUNDER_SIGNUP_SID=HX… TWILIO_WA_CLIENT_APPROVED_SID=HX…` then redeploy `notify`.
3. Live round-trip on a real phone: throwaway Google account → request form → founder gets the button message → tap Approve → applicant phone receives the approved CTA → button opens the app → onboarding starts with phone pre-filled.

## Verification checklist

- `npm run lint` and `npm run build` pass after each commit; `notify` deploys cleanly.
- MCP `get_advisors` clean after the migration; `schema.sql` regenerated and committed with it.
- **Existing users**: every pre-migration profile has `approval_status = 'approved'`; an existing client logs in and sees zero change (no pending page, no re-onboarding).
- **Invite path**: a `client_invites` row for phone X + new signup submitting phone X → auto-approved, no founder notification, straight to onboarding.
- **New signup**: fresh account → `/app/*` all redirect to `/app/pending` → form submit inserts exactly one founder `signup_request` notification; resubmitting with a corrected phone updates it in place (no duplicate).
- **RLS**: as a pending client (MCP `execute_sql` with impersonated claims, like the skills plan's spot-checks): zero rows from `class_sessions`/`coaches`/`plans` (+ whatever else Part 5 tightened); after approval, rows return. Marketing pages still render/build.
- **Approve** (admin path and WA path each): profile flips to `approved`, `wa_links` row exists for the phone, one `signup_approved` notification delivers over WhatsApp with the CTA button (or generic template pre-approval), pending page auto-redirects into onboarding within one poll cycle.
- **Deny**: profile `denied`, no outbound message anywhere, pending page shows the neutral contact copy; "Approve anyway" from admin later works.
- **Idempotency**: second Approve tap (or admin approve after WA approve) replies/returns "already handled" and changes nothing.
- Quiet hours: `signup_request` sends at 23:00 IST; `signup_approved` created at 23:00 defers to 08:00.
