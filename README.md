# Sharwin TTA — the website

A marketing site with one live page on it: the public timetable.

Everything that used to sit behind a login here — booking, memberships, the
coach app, the founder's admin, the WhatsApp assistant, the notification
worker, the whole Supabase schema — has moved to **bluetick**, which runs the
academy over WhatsApp. What is left is the shop window, plus a read-only view
of the week that bluetick publishes.

There is no database in this repo, no auth, and no server-side writes.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint
```

`.env.local` holds the handful of values the site reads — see `.env.example`,
which lists every one of them and what it is for.

## The pages

| Route | What it is |
| --- | --- |
| `/` | The landing page: hero, record, programmes, venues map, founder, coaches, testimonials, camp, hiring, FAQ, contact. |
| `/schedule` | **The timetable.** This week's group classes by day and venue, from bluetick. Prev/next week. Server-rendered, cached 5 minutes. |
| `/locations` | The venues, nearest first, on the map. Each links to `/schedule`. |
| `/coaches` | The coaching roster. |
| `/schools`, `/colleges` | The institutional pitches. |
| `/legal/[slug]` | Terms, privacy, safeguarding. |
| `/api/whatsapp` | The old Twilio number's autoresponder: "we've moved", plus a link to the new thread. Reads nothing, writes nothing. |

Every call to action on every page is the same WhatsApp link
(`components/marketing/WhatsAppCta.tsx`). There is no sign-up, no login, and no
booking screen: `/login`, `/signup`, `/app`, `/coach`, `/admin` and `/school`
are redirects to `/schedule` so old links land somewhere sensible.

## Where the data comes from

Two sources, and they are different in kind.

**1. Reference data — `content/academy.json`, checked in.**
Venues, coaches, plans and products. They change a few times a year, so they
are a file rather than a query. `lib/data.ts` reads it; `getVenues()`,
`getCoaches()`, `getPlans()` and `getProducts()` still have the signatures the
pages always used.

Regenerate it from Sharwin's Supabase project (read-only) when the founder adds
a venue or a coach:

```bash
npm run content        # node scripts/export-content.mjs
```

That script is the only thing in the repo that talks to Supabase. It also
downloads any remote photo into `public/images/content/…` and rewrites the JSON
to the local path, so the built site never depends on Supabase being up.
Commit the JSON and the images together.

**2. The timetable — bluetick, at request time.**
`lib/bluetick.ts` GETs bluetick's public diary endpoint (contract in
`AGENTS.md`) with a 5-minute revalidate. It never throws: if the diary cannot
be loaded, `/schedule` renders its shell with a stated gap and a WhatsApp link,
rather than an empty grid that would read as "no classes this week".

## Deploying

Vercel, region `hnd1` (`vercel.json`) — the audience is in Bengaluru.

Set `BLUETICK_URL`, `BLUETICK_DIARY_KEY`, `NEXT_PUBLIC_BLUETICK_KEY`,
`NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` and `TWILIO_AUTH_TOKEN`.

The full cutover — and how to reverse it — is `docs/bluetick-cutover.md`.

## Layout

```
app/                 routes: marketing pages, /schedule, /api/whatsapp
components/marketing the sections the pages are built from
components/shells    StageShell + StageHeader (the ink site chrome)
components/ui        Button, Badge, Skeleton, Spinner, SectionDivider
lib/bluetick.ts      the diary client — the one coupling to bluetick
lib/data.ts          content/academy.json, typed
lib/academy-time.ts  every date format on the site, in academy time
content/academy.json venues, coaches, plans, products (generated)
scripts/             export-content.mjs (read-only) · export-to-bluetick.mjs
public/images/       photo library, including content/ (generated)
```
