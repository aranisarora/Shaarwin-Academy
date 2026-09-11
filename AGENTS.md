<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# There is no database

This repo used to be a full-stack academy app on Supabase. It is not any more.
Booking, memberships, coaches, schools, notifications and the WhatsApp
assistant all moved to **bluetick**; the migrations, RPCs, RLS policies,
generated types, edge functions and the test harness that went with them were
deleted, not archived. Do not reintroduce them, and do not write SQL here.

Nothing in `app/`, `components/` or `lib/` may import `@supabase/*`. The site
builds and serves with no credentials at all except a Mapbox token.

## Reference data is a file

`content/academy.json` holds the venues, coaches, plans and products.
`lib/data.ts` is the only reader; the pages call `getVenues()`, `getCoaches()`,
`getPlans()`, `getProducts()`.

It is regenerated, never hand-edited:

```bash
npm run content        # node scripts/export-content.mjs
```

That script reads `.env.local` by hand and SELECTs from Sharwin's Supabase
project. **It is read-only and must stay read-only** — it is the last thread
back to that database, and the database is still live for the historical
record. It also downloads remote photos into `public/images/content/<kind>/`
and rewrites the JSON to the local path, so a built site never fetches from
Supabase Storage. Commit the JSON and the downloaded images together.

## The timetable comes from bluetick

`/schedule` reads bluetick's public diary through `lib/bluetick.ts`. Both sides
are built to this text; change neither half alone.

```
GET {BLUETICK_URL}/api/diary/{key}?from=YYYY-MM-DD&days=N
  - {key} is workspace.key (three hyphenated words, e.g. lurk-salt-card).
  - from: a local date on the workspace's clock; default = today on that clock.
    days: default 7, min 1, max 42.
  - The window is [from 00:00, from+days 00:00) in the workspace timezone.
200 application/json
  { ok: true,
    workspace: { name: string, timezone: string, key: string },
    from: "YYYY-MM-DD", until: "YYYY-MM-DD",
    events: [ { id: uuid, title: string,
                starts_at: string, ends_at: string|null,     // ISO 8601 WITH the workspace's UTC offset, e.g. 2026-09-14T18:00:00+05:30 — never a trailing Z
                status: "scheduled"|"cancelled",
                host: { id: uuid, label: string }|null,      // label = member.label of host_id in this workspace
                capacity: integer|null,
                taken: integer,                              // count of booking rows at status booked or attended
                series_key: string|null,
                attrs: object } ]                            // event.attrs verbatim
      sorted by starts_at asc, then title }
404 { ok:false, error: string } — when no workspace with archived_at IS NULL carries that key with attrs->>'public_diary' = 'true'. Does not distinguish "no such key" from "not public".
400 { ok:false, error } on a malformed from/days.
Response headers: Cache-Control: public, s-maxage=300, stale-while-revalidate=900
event.attrs as bluetick's import writes them (the page reads these keys):
  { kind: "group"|"private"|"school", venue: string|null, venue_unit: string|null, address: string|null,
    school: boolean, sharwin: { class_id: uuid|null, session_id: uuid|null, series_id: uuid|null }, imported: string }
```

Three rules the page depends on:

1. **Do not re-zone the timestamps.** `starts_at` already carries the academy's
   UTC offset, so the date portion of the string *is* the day the class is on.
   Converting to an instant and formatting through a timezone would move a
   late-evening class across midnight the moment an offset ever changed. Use
   `isoWallDate` / `formatIsoWallClock` in `lib/academy-time.ts`.
2. **Hide what is not public.** `attrs.school === true` is somebody's campus and
   `attrs.kind === 'private'` is somebody's home address. Neither belongs on a
   public page.
3. **A failed fetch is a stated gap, never an empty grid.** `fetchDiary` returns
   `{ ok: false, reason }` and never throws; the page says the timetable can't
   be loaded and offers WhatsApp. An empty week silently reads as "no classes",
   which is a lie that costs the academy attendance.

## Dates

Every user-facing timestamp goes through `lib/academy-time.ts` — the academy
runs on Asia/Kolkata and the reader may not. ESLint enforces this: building an
`Intl.DateTimeFormat` or calling `toLocaleString` under `app/`, `components/`
or `lib/` is an error. Add the shape you need to `academy-time.ts` and import
it.

## Calls to action

There is one, and it is `components/marketing/WhatsAppCta.tsx`. The number and
the prefilled workspace key live in `lib/contact.ts`. One WhatsApp number
serves every bluetick workspace, so the key has to lead the message or the
assistant cannot tell which business the sender means — never hand-write a
`wa.me` URL.

## The old Twilio number

`app/api/whatsapp/route.ts` is an autoresponder, not a bot: it validates
`X-Twilio-Signature` and replies with one sentence pointing at the new number.
It has no imports beyond `node:crypto`. Keep it that way.

## Scripts

- `scripts/export-content.mjs` — reference data, read-only (above).
- `scripts/export-to-bluetick.mjs` — the one-time migration of the live
  academy into bluetick. See `scripts/README.md`.

## Cutover

`docs/bluetick-cutover.md` is the runbook: what moved where, the switch in
order, and how to reverse it.
