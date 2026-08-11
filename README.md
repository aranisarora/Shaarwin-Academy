# Sharwin TTA — Table Tennis Academy

Production Next.js app built to the `sharwin-build` package plan: dark
image-led marketing site (Stage mood), client booking app, coach app and
founder admin (Studio mood), on Supabase + Razorpay + Mapbox.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (passes clean)
```

`.env.local` is already populated with the Supabase URL/anon key and Mapbox
token. Two secrets are still placeholders — see Go-live below.

## What's live right now

- **Marketing site** `/` `/locations` `/coaches` `/schools` `/colleges` `/legal/*` — reads
  venues, plans, classes and sessions from the live Supabase project (already
  seeded: 3 venues, 3 plans, 4 classes, 4 weeks of sessions, settings).
- **Auth** — email OTP + Google via Supabase; role-routed by `proxy.ts`
  (client → `/app`, coach → `/coach`, founder → `/admin`).
- **Client app** — home, map-first booking with booking sheet + waitlists,
  schedule with cancel windows, private-session wizard (address → pin → slots
  → confirm), membership screen, notifications inbox, `.ics` downloads.
- **Coach app** — Today timeline with travel gaps, session sheet (attendance,
  autosaving notes, report problem, can't-make-it cover), calendar, players.
- **Founder admin** — KPI dashboard + exceptions inbox, master calendar with
  unassigned lane + tap-to-reassign (+ lock), classes, coaches, clients,
  settings editor.
- **PWA** — manifest, icons, service worker (app-shell cache + push handlers).
- **Design system** — Court Noir tokens, Fraunces/Inter, both moods. Defined in
  `app/globals.css`; the card language is documented in
  `components/app/ClassCard.tsx`.

Booking/cancel/private flows call the SQL RPCs first and fall back to
equivalent JS logic until the migrations are applied, so the app works today
and hardens automatically once you run the SQL.

## Go-live checklist

1. **Apply the SQL** (Supabase SQL editor, in order):
   `supabase/migrations/0001_rls_auth.sql` → `0002_billing.sql` →
   `0003_booking_rpcs.sql` → `0004_assignment_engine.sql` →
   `0005_private_reschedule.sql`. This turns on full RLS and the race-proof
   RPC contracts (`book_session`, `assign_coach`, …).
   Then apply `0011_razorpay_inr.sql` to switch pricing to INR (paise) and add
   the Razorpay columns.
2. **Service role key** — put the real `SUPABASE_SERVICE_ROLE_KEY` in
   `.env.local` (Razorpay webhook mirroring uses it).
3. **Coach accounts** — `node scripts/seed-live.mjs` is idempotent; rerun it
   once the Supabase email rate limit clears (built-in SMTP allows ~2
   emails/hour) to create the coach + demo-client accounts, or create users in
   the dashboard with matching emails. To make an account the founder/coach,
   set `profiles.role` accordingly.
4. **Razorpay** — set `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`, run
   `node scripts/razorpay-setup.mjs` (creates quarterly INR Plans and links
   them to `plans`), then add a webhook in the Razorpay Dashboard pointed at
   `/api/razorpay/webhook` (events: `subscription.activated`,
   `subscription.charged`, `subscription.pending`, `subscription.halted`,
   `subscription.cancelled`, `subscription.completed`) and set
   `RAZORPAY_WEBHOOK_SECRET` to the secret you chose there. Until then, checkout
   reports "billing not configured" and comp subscriptions keep booking working.
5. **Notifications delivery** — deploy `supabase/functions/notify` on a
   1-minute cron (command in the file header). Resend key is already in env.
6. **Deploy** — Vercel: set the same env vars, `NEXT_PUBLIC_APP_URL` to the
   real domain.

## Seeded logins

- Founder: `aa5925+seedfounder@ic.ac.uk` (log in via email OTP) — role is
  already `founder`, lands on `/admin`.

## Layout

```
app/                 routes (marketing, app, coach, admin, api)
components/          ui kit, shells, marketing, app components
lib/                 supabase clients, auth guard, data access, razorpay
supabase/migrations  RLS + RPC contracts (apply in order)
supabase/seed.sql    canonical idempotent seeds (service role)
scripts/             seed-live.mjs · razorpay-setup.mjs · make-icons.mjs
public/images/       generated Court Noir image library + real photos
```
