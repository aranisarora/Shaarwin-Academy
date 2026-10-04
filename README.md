# Sharwin Table Tennis Academy

Next.js app for the academy: the marketing site, the client booking app, the
coach app, the school view and the founder admin, on Supabase, Razorpay,
Mapbox and Twilio WhatsApp.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

`.env.local` points at the live Supabase project. Anything you do in the
running app writes to production data.

## The gate

Nothing is done until all of these pass:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

`npm run test:db` needs Docker and the local stack (`npm run db:start`, then
`npm run db:reset`). It is the gate for any change to SQL.

## Where the rules live

- `AGENTS.md`: the database rules (schema, migrations, types), how production
  is reached, the operational facts (crons, settings, secrets, the `notify`
  deploy) and the test harness.
- `docs/notifications.md`: what the academy sends, to whom and why.
- `docs/whatsapp-messaging.md`: the WhatsApp transport and the bot.
- `e2e/README.md`: the local Playwright harness.

## Layout

```
app/                 routes (marketing, app, coach, school, admin, api)
components/          ui kit, shells, marketing and app components
lib/                 supabase clients, auth, data access, admin ops, whatsapp bot
supabase/schema.sql  the canonical schema
supabase/migrations  the record of every change applied to production
supabase/functions   the notify edge function (deployed by hand)
supabase/seed.sql    local seed data for db:reset
scripts/             test-db-reset.mjs · razorpay-setup.mjs · gen-app-icons.mjs · whatsapp/
tests/db/            database specs (npm run test:db)
e2e/                 Playwright flows
```
