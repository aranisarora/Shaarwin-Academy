# Private booking UX rework — plan

**Goal:** the client private-booking wizard (`/app/book/private`) should feel as frictionless as
Uber on a phone: location resolves itself, times load instantly, recurring slots read as
"Every Tuesday, 5 pm" not a wall of dates.

**Audience:** implementing model. All root causes below are verified against the code — don't
re-derive them, just build the fixes. Mobile is the primary viewport (~390px); design every
change for one thumb.

Files involved:

| File | Role |
| --- | --- |
| `components/app/PrivateWizard.tsx` | The 4-step wizard (address → times → confirm → done) |
| `components/app/AddressForm.tsx` | Shared address form (search + pin map + manual fields) |
| `components/app/AddressSearch.tsx` | Mapbox Search Box typeahead (`/suggest` → `/retrieve`) |
| `components/app/LocationPinMap.tsx` | Draggable pin map |
| `lib/address.ts` | `StructuredAddress`, `applyGeocode`, `EMPTY_ADDRESS` |
| `app/app/book/private/actions.ts` | `getSlots` (calls `get_bookable_slots` RPC), booking actions |
| `lib/venue-display.ts` | `makeVenueResolver` — private-class venue title for coach/admin |
| `app/admin/weekly/page.tsx` | Admin "Weekly classes" tab (group classes only — see §5) |

No Postgres function changes are required for any of this. Everything is client/UI work, so
per the harness conventions no new `tests/db/` specs are needed; `npm run test:db` must still
pass untouched.

---

## 1. Address step: autofill leaves no pin, and no path to "use my location"

### Root cause (verified)

`AddressSearch` only produces coordinates when the user **taps a suggestion** — `choose()`
calls Mapbox `/retrieve` and fires `onSelect`, which is the only path that sets
`addr.lat/lng` (via `applyGeocode`). When the browser **autofills** the input (or the user
types a full address and never taps), only `formatted` is set; `lat/lng` stay `null`, so:

- the pin map never renders (`hasPin` false in `AddressForm.tsx:65`),
- coverage never gets checked (`covered` stays `null`),
- the "Choose a time" button stays disabled (`isAddressComplete` requires lat+lng,
  `PrivateWizard.tsx:349`) **with no explanation** — the user is stuck.

Same issue on first load for returning users: `profiles.default_address` is a bare `text`
column, so the prefill (`PrivateWizard.tsx:92-94`) has `formatted` but no pin either.

### Fixes

**1a. "Use my current location" button (the Uber move).**

Add a prominent button *above* the search input in `AddressForm` (opt-in via a new prop,
e.g. `showUseMyLocation` — enable it from `PrivateWizard`; other callers unchanged):

- Full-width, secondary style, with a location/crosshair icon:
  `📍 Use my current location` (use an inline SVG consistent with the design system, not an
  emoji).
- On tap: `navigator.geolocation.getCurrentPosition` with
  `{ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }`. Show a spinner state on
  the button while resolving.
- Reverse-geocode the coordinates with the **same Search Box API** already used
  (`https://api.mapbox.com/search/searchbox/v1/reverse?longitude=…&latitude=…&language=en&access_token=…`),
  take the first feature, and build a `GeocodeHit` exactly like `choose()` does in
  `AddressSearch.tsx:107-143` (same `properties`/`context` parsing — extract that parsing
  into a shared helper, e.g. `featureToGeocodeHit(feat)` exported from `AddressSearch.tsx`,
  rather than duplicating it).
- Feed the hit through the existing `pick()` path in `AddressForm` so the query text, pin map
  and coverage check all light up identically to a tapped suggestion. The user then drags the
  pin to their exact entrance — that's the Uber flow: GPS gets you close, the pin makes it
  exact.
- Permission denied / timeout / no Mapbox token → show a quiet inline message
  ("Couldn't get your location — search instead") and leave the search flow untouched. Never
  block on it.
- Do **not** request location on mount — only on tap. (Auto-prompting on page load is the
  anti-pattern; the button is the prompt.)

**1b. Auto-resolve typed/autofilled text — never dead-end the user.**

Keep the "Choose a time" button logic, but when the address text is non-empty and there's no
pin, the user needs a way forward:

- In `AddressForm`, when the input **blurs** (or 1.5 s after typing stops) with
  `query.length >= 3 && !selected`, and the suggestions list is non-empty, keep the dropdown
  open (it already does this) **and** add a one-line hint under the input:
  *"Pick a match so we can pin your door."*
- Additionally, make the wizard self-heal: in `PrivateWizard`, render the disabled-reason as
  text under the CTA (see 1c) and add an explicit fallback — if `addr.formatted` is set but
  there's no pin, show a small "Find this address on the map" action that runs
  `/suggest` with the current text and auto-retrieves the **top** suggestion (reuse the
  session-token pattern). This covers browser autofill, pasted addresses, and the
  `default_address` prefill in one mechanism.

**1c. Explain the disabled CTA.**

Under the "Choose a time" button, when it's disabled, render one small `text-fg-2` line
naming the *first* unmet condition, in this order:

1. no pin → "Search your address or use your current location to drop a pin."
2. `requireFlat` unmet → "Add your flat / unit number."
3. `covered === false` → (already has its own card — no extra line)
4. `!hasTable` → (already explained inline by the table toggle)

A disabled button with no reason is the single biggest friction point in the current step.

**1d. Persist the structured default address (small, high-leverage).**

After a successful booking, the wizard already sends `details: addr` to the RPCs. Also
persist it back to the profile so next time step 1 is pre-solved:

- Add a nullable `default_address_details jsonb` column to `profiles`
  (migration under `supabase/migrations/`, then **regenerate `supabase/schema.sql` via the
  Supabase MCP and commit both together** — the pre-commit hook enforces this).
- On confirm success, fire-and-forget an update of `default_address` (formatted) +
  `default_address_details` (the full `StructuredAddress`).
- In `page.tsx`, select the new column and pass it through; in `PrivateWizard`, initialise
  `addr` from `fromDetails(defaultAddressDetails, { address: defaultAddress })`
  (`lib/address.ts:109`) so a returning client lands on step 1 with pin + map + coverage
  already green and can go straight to "Choose a time". Show the saved address as a
  tappable card ("Home — Prestige Lakeside, flat 402 · Change") instead of an empty form —
  that's the Uber "saved places" pattern.

This is the only DB change in the plan and it's additive (no function changes, no RLS
changes needed beyond the existing profiles self-update policy — verify that policy covers
the new column, it should since policies are row-level).

---

## 2. Slow slot loading → prefetch so step 2 is instant

### Root cause (verified)

`getSlots` is only called inside `toStep2()` (`PrivateWizard.tsx:141-149`) — i.e. *after* the
user taps "Choose a time" — so the user always stares at a spinner for a full
client → Vercel → Supabase round-trip (India users on Tokyo hosting per our perf notes; the
`get_bookable_slots` RPC itself is a cheap set-based query, the latency is the trip).

### Fix

**Prefetch on step 1 as soon as the inputs are known.** In `PrivateWizard`:

- Add an effect watching `[pin?.lat, pin?.lng, covered, duration, playerId]`: when
  `pin && covered === true`, call `getSlots` immediately and cache the result in state
  together with its key `{lat,lng,duration,playerId}`.
- `toStep2()` uses the cache when the key matches; otherwise it falls back to the current
  fetch-with-spinner. `changeDuration` keeps its refetch (it's a new key).
- Abort/ignore stale prefetches with the same cancelled-flag pattern already used by the
  coverage effect (`PrivateWizard.tsx:121-133`).

Result: by the time a human has toggled the table switch and tapped the CTA, the slots are
already in memory — step 2 renders instantly in the common case. No RPC change, no new
endpoint.

---

## 3. Weekly (recurring) slots should read as day + time, not dates

### Root cause (verified)

In weekly mode the grid renders every concrete date-time (`fmtSlot` → "Tue 4 Aug, 5:00 pm"),
and dedupe of the same weekday+time across the two-week window is handled by *disabling* the
duplicate ("You've already picked this weekly slot") — so the same weekly slot appears twice
and the recurring nature is only explained in a small paragraph of copy.

### Fix

In weekly mode, **collapse the slot list to weekly identities before rendering**:

- Group `slots` by the existing `weeklyKey(iso)` (weekday + HH:mm in IST,
  `PrivateWizard.tsx:58-66`); each group's representative is its **earliest** `starts_at`
  (that's the date the series actually starts — `create_private_series` derives
  weekday/time from the first occurrence, so passing the earliest is already correct for the
  RPC; no action/RPC change).
- Render each option as the weekly identity: **"Tuesdays · 5:00 pm"** as the primary label,
  with "starts 4 Aug" as a secondary `text-xs` line inside the chip. The `dupWeekly`
  disable logic dies — there are no duplicates left to disable.
- Step 3 (confirm) and step 4 already use `fmtWeekly` — keep, but flip emphasis to match:
  "**Every Tuesday, 5:00 pm** — first session 4 Aug".
- Keep one-off (minutes-only) mode rendering concrete dates exactly as today.

---

## 4. Organise the time picker: day first, then times (mobile-first)

### Root cause (verified)

The picker is a single `max-h-72` scrolling 2-column grid of up to 60 buttons
(`PrivateWizard.tsx:453-486`), each carrying full "Wed 30 Jul, 5:00 pm" text — 14 days of
30-minute increments flattened into one undifferentiated list. `slice(0, 60)` also silently
truncates the horizon to ~the first few days.

### Fix — two-level picker (the Uber/Calendly pattern)

**One-off mode:**

1. **Day selector:** a horizontally scrollable row of day pills ("Wed 30", "Thu 31", "Fri 1",
   …) built from the distinct IST dates present in `slots`. Days with no slots don't appear.
   First available day selected by default. Pills: `min-h-11`, snap scrolling
   (`snap-x`), selected = ember fill like the existing duration buttons.
2. **Time grid for the selected day:** 3-column grid of time-only chips ("7:00 am",
   "7:30 am", …). Group with tiny "Morning / Afternoon / Evening" `label` headers when the
   day has more than ~8 slots (boundaries: <12 pm, 12–5 pm, ≥5 pm IST). Drop the
   `slice(0, 60)` cap — per-day lists are naturally short; keep the `max-h-72` scroll only
   inside the time grid.
3. Selected slots can span multiple days; show the running selection as removable chips
   ("Wed 30 Jul · 5:00 pm ✕") directly above the Review button so the user never loses track
   of picks made on other days.

**Weekly mode:** same shell, but the first level is **weekday pills** ("Mon", "Tue", …, only
weekdays that have any servable time), and the second level is the deduped weekly times from
§3. Selection chips read "Tuesdays · 5:00 pm".

Extract the picker into a small component in the same file (or
`components/app/SlotPicker.tsx` if `PrivateWizard` gets unwieldy) taking
`{ slots, mode: "dates" | "weekly", selected, maxSlots, onToggle }` — keep the state where
it is in the wizard.

All timezone formatting stays `Asia/Kolkata` via `Intl.DateTimeFormat` exactly as the
existing helpers do; derive day-bucket keys with the same mechanism (never local device TZ).

---

## 5. Venue title for coaches/admins — how it works today (context + one gap)

**Where the title comes from (no bug here — verified):** private classes have no `venues`
row. Coach day view (`lib/coach-data.ts:124`), admin schedule (`app/admin/schedule/page.tsx:196`)
and the admin session sheet all resolve a display name via
`makeVenueResolver` (`lib/venue-display.ts`), in this order:

1. exact normalised match of the private address against a known venue's address,
2. the geocoded **POI name** captured at booking time (`address_details.name` — set only
   when the client picked a POI suggestion, `AddressSearch.tsx:124`),
3. nearest known venue within ~150 m of the pin,
4. else the first comma-segment of the raw address.

So "Apartment XYZ" shows up for coaches/admins *only if* it's the POI name Mapbox returned
or the first segment of the formatted address. **Consequence for §1a:** a reverse-geocoded
"current location" hit is an *address*, not a POI, so `name` will be null and the fallback
is the street segment — acceptable, and the client's `building` field ("Building / society
name") is already captured separately for the coach's directions. No change needed, but
don't regress `address_details` persistence: the reverse-geocode path must still write the
full `StructuredAddress` through the existing `details` payload.

**Admin "Weekly classes" tab — answer to the open question:** **No**, a recurring private
booking never appears there. `/admin/weekly` filters `classes` on `class_type = 'group'`
with a `recurrence_rule` (`app/admin/weekly/page.tsx:27-28`), while client weekly privates
live in `private_booking_series` (created by `create_private_series`) — a table with **no
admin UI at all** (only the WhatsApp ops layer reads it). The generated sessions do appear
on the admin **Schedule** tab as instances, but there is nowhere the founder can see or end
a standing private slot.

**Fix (decided with the founder): unified location grouping.** `AdminWeeklyClasses`
already groups rows under a plain `venueName` string (`components/app/AdminWeeklyClasses.tsx:112-119`
builds `venueGroups` keyed on `c.venueName ?? ""`), so private series join the *same*
grouping rather than a separate section — one mental model: **location → weekly classes**.

Target layout (founder-approved mock):

```
WEEKLY CLASSES

▾ Windmills Clubhouse              [venue]
   • Beginners U-12 — Tue 5:00 pm · Coach Ravi · 6/10
   • Intermediate — Thu 6:30 pm · Coach Ravi · 8/10
   • Vivaan (private) — Every Wed · 4:00 pm · 60 min

▾ Apartment XYZ                    [private]
   • Aarav (Mehta family) — Every Tue · 5:00 pm · 60 min

[ + Create a class ]
```

Implementation:

- In `app/admin/weekly/page.tsx`, also query `private_booking_series` where `active`,
  joined to player + client names. Resolve each series' location name with
  `makeVenueResolver` (the page already fetches `venues` with
  `address,lat,lng,address_details` — pass the series' `{ address, lat, lng,
  address_details }`).
- **Key behaviour:** because the resolver matches exact venue address, then POI name, then
  any venue pin within ~150 m, a private series booked *at an existing venue* resolves to
  that venue's name and therefore nests under the existing venue group alongside its group
  classes. Only genuinely new locations (client homes) spawn their own group. No `venues`
  row is ever created — grouping stays display-only. To avoid near-duplicate groups when
  the pin lands just outside 150 m, also fold a resolved name into a venue group when it
  equals a venue name case-insensitively.
- Feed the series rows into `AdminWeeklyClasses` as a new prop (e.g.
  `privateSeries: PrivateSeriesRow[]`) and merge them into the same `venueGroups` keyed on
  the resolved name. Groups whose name matches a known venue keep the venue badge; pure
  private locations get a `[private]` badge on the group header.
- Row rendering for a private series: "{player} (private) — Every {weekday} · {time} ·
  {duration} min", plus client family name; preferred coach if set. Sorted into the same
  day/slot order as group classes within the group.
- The venue filter dropdown (`AdminWeeklyClasses.tsx:86`) builds its options from the
  grouped names, so private locations appear in it automatically — verify, don't rebuild.
- **This pass is view-only:** tapping a private-series row deep-links to its next generated
  session on the Schedule tab (find the next `class_sessions` row for the series the same
  way the page already finds `nextSessions` for classes). End/pause/reassign from this tab
  is an explicit follow-up, not in scope.
- Check RLS: `private_booking_series` must be selectable by the founder role; if the
  existing policy only covers the owning client, add a founder-read policy in the same
  migration as §1d (and regenerate `schema.sql` in that same commit). (Verified: a
  "founder all private series" policy already exists in `schema.sql` — confirm it, then
  no migration needed for this part.)

**Venues stay curated — do NOT auto-create venue rows from private bookings.** Private
addresses are copied by value into `private_booking_series` / `private_class_details` and
never touch the `venues` table; `/admin/venues` and the public marketing map (`VenueMap`
on /locations) read only `venues`, so auto-inserting would publish client home addresses.
Note that *admin*-created privates (AdminAddSheet → `createPrivateSessionCore`) already
snapshot a picked venue's address with `addressDetails.name = venue.name`, so they resolve
cleanly; only client-home bookings produce free-form location groups. Follow-up (out of
scope): a founder-only "Save as venue" action on a private-only location group, for when a
client's clubhouse becomes a genuine shared teaching location.

---

## Acceptance checklist

Mobile viewport (390×844) for all of these:

1. Autofill or paste a full address without tapping a suggestion → the wizard offers a way
   forward (hint + "find on map" fallback) and the CTA explains itself; after resolution the
   pin map appears and "Choose a time" enables.
2. Tap "Use my current location" → within a few seconds the address line, pin map and
   coverage state are filled; dragging the pin still re-checks coverage. Denying the
   permission shows the inline fallback message and search still works.
3. Returning user with a saved structured address lands on step 1 already complete.
4. Tapping "Choose a time" after normally filling step 1 shows slots with **no spinner** in
   the common case (prefetched).
5. Weekly-plan client sees "Tuesdays · 5:00 pm" style options, no duplicate weekday+time
   entries, and confirm/success screens lead with the recurring identity.
6. One-off client picks times via day pills → time chips; selections across days show as
   removable chips; more than 60 total slots no longer get silently cut off.
7. Coach and admin views of a booked private class still show the resolved venue/POI title
   (no regression in `address_details` written by any new path).
8. Admin Weekly tab shows active private series inside the unified location grouping: a
   series booked at a known venue appears under that venue's existing group; a series at a
   client home appears as its own location group with a private badge. Rows are view-only
   and deep-link to the next session on the Schedule tab.
9. `npm run test:db` passes untouched; run the existing `e2e:flows` suite; extend
   `e2e/flows/` with a client private-booking journey only if selectors the specs rely on
   changed (none of the coach specs touch this wizard today).

## Sequencing for implementation

1. §1c (disabled-CTA reasons) + §2 (prefetch) — smallest, immediately felt.
2. §1a + §1b (current location + auto-resolve) — includes the `featureToGeocodeHit` refactor.
3. §3 + §4 together (they share the picker rewrite).
4. §1d + §5 in one commit (single migration: profiles column + any series RLS; regenerate
   `supabase/schema.sql` via MCP in the same commit — hook enforces it).
