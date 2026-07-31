# One location model for every class

**Status:** in progress · **Decided:** 31 Jul 2026

## The problem this replaces

A private session had no venue. Six call sites each derived a display name from
the geocoded address string, via a six-tier ladder (`location_label()` in SQL,
`makeVenueResolver()` in TypeScript). The ladder worked, but it was inference:
the system parsed a string it had itself thrown information away to produce.

Two findings killed the ladder rather than improved it:

1. **The admin add sheet already picks a venue from a dropdown**
   (`AdminAddSheet.tsx`), resolves it to a venue row, copies that row's
   `address`/`lat`/`lng` onto the private — and discards the id. 110 of 167
   privates are a known `venue_id` laundered into a string and parsed back.
2. **Clients already type the complex name** into `address_details.building`,
   and the resolver never read it. The five sessions labelled `6th Main Road 2`
   carry `building: "Embassy pristine"`, `floorTower: "Tower 1"`, `flat: "171"`.

Across all 167 privates there are only 20 distinct labels, and 18 of them are
named complexes, schools or academy venues. There is one genuine standalone
address on the book. "Complex + unit" is therefore a format that fits
essentially every session, not a special case.

## The model

Every class answers "where?" the same way, in three parts:

| part | meaning | example |
|---|---|---|
| venue name | the complex you drive to | `Adarsh Palm Retreat` |
| venue unit | which part of it has the tables | `Villas` · `Apartments` |
| session unit | where inside that | `Clubhouse` · `Villa 659` · `Tower 1, flat 171` |

Composed as `name unit — session unit`:

```
Adarsh Palm Retreat Villas — Clubhouse
Adarsh Palm Retreat Apartments — Clubhouse
Embassy Pristine Apartment — Tower 1, flat 171
```

**Nothing is parsed at read time.** Every part is chosen by a human at booking
and stored. `location_label(classes)` survives as a name so the six existing
callers don't change, but collapses to a lookup.

### Why the venue unit is a safety field, not a display nicety

Within one complex the villas' clubhouse and the apartments' clubhouse are
**mutually inaccessible** — a villa resident can't get into the towers' club and
vice versa. A coach told "APR — Clubhouse" has even odds of standing at a gate
that won't open for them.

So the rule is: **a session's unit is never shown without its venue's unit.**
That holds by construction, since `location_label` always composes the full
`venue_display` (which carries `venues.unit`) before appending the session's
own unit.

The one hole left is attaching a session to a bare complex and typing
"clubhouse". Closed in the venue manager: **if a venue shares its `name` with
another venue, `unit` is required.** Once a complex has more than one
sub-venue, none of them can be nameless, so a bare `Adarsh Palm Retreat` is
never selectable.

### Where each part comes from

```
class has venue_id ──► venues.name  +  venues.unit          (group + known-venue privates)
otherwise          ──► private_class_details.venue_label
                       + private_class_details.unit_label   (genuine one-offs)
```

Prefer `venue_id` wherever a venue exists: a rename then propagates to every
message, past and future, instead of freezing a typo into 37 rows.

### Schema

- `venues.unit text` — sub-location within a complex. Null for a plain venue.
- `private_class_details.venue_label text`, `.unit_label text` — for privates
  not at a known venue.
- `classes.venue_id` is now set on privates too. Already nullable; no
  constraint change. The public `/locations` page must keep filtering to group
  classes so a private never leaks a family's session onto it.

### Functions

- `venue_display(venues)` → `name` or `name, unit`.
- `location_venue(classes)` → the venue part alone (for grouping/sorting).
- `location_label(classes)` → venue + unit, the string every message uses.

The six-tier ladder, `address_head()`, `is_informative_place()` and the whole
of `makeVenueResolver()` are deleted. The ladder survives only inside the
one-time backfill.

## APR

`Adarsh Palm Retreat` was four venue rows. Two of them (`APR Tower 1`,
`APR lakefront`) have zero classes and zero privates — merging is free.

| before | after (name, unit) | carries |
|---|---|---|
| APR Apartments | Adarsh Palm Retreat, Apartments | 2 classes, 37 privates |
| APR Tower 1 | *deleted* — same place as Apartments | nothing |
| APR Villas | Adarsh Palm Retreat, Villas | 22 privates |
| APR lakefront | Adarsh Palm Retreat, Lakefront | nothing |

Rows are kept, not collapsed, because each holds its own pin and the coach
arrival geofence reads it. Lakefront sits ~600m from the villas; APR
Apartments' pin is ~1.3km from Tower 1's. Collapsing to one row would move a
geofence under 2 live group classes.

APR stops being an exception: every venue is now name + optional unit.

## Booking: one picker, both paths

Admin and client use the same control:

1. **Known venues as chips** — one tap, sets `venue_id`. The admin's dropdown
   becomes the top row of the shared picker; a client at APR can tap it too.
2. **Mapbox search** below, for anywhere else.
3. **Unit — required either way.** Prefilled from `building`/`floorTower`/`flat`
   when the geocoder or a saved address offers them.

`_create_private_occurrence` takes `p_venue_id`, `p_venue_label`,
`p_unit_label`. `createPrivateSessionCore` passes `venueId` straight through
instead of copying an address. The founder WhatsApp tool already accepts
`venue_id` — it just needs to stop discarding it.

## Backfill

167 privates, in three groups:

- **Exact venue address match → `venue_id`.** Deterministic, ~110 rows.
- **Named place → `venue_label` + `unit_label`,** in this order: geocoded POI
  matching a known venue, then the typed `building`, then the bare POI, then
  `locality`.
- **Leftovers, and anything where those sources disagree → a review screen.**
  Distinct (venue, unit) pairs with session counts, editable, with "attach to
  an existing venue". Roughly 5-10 rows to eyeball. Nothing is silently
  guessed.

The typed `building` is deliberately **not** authoritative. Five sessions carry
`building: "Apr Apartment"`, `floorTower: "tower 4"`, `flat: "clubhouse"` — but
they are the *villas'* clubhouse (founder, 31 Jul). The geocoded POI
(`APR Villas`) was right and the human field was wrong, which is exactly why
disagreement routes to review instead of picking a winner. Their backfilled
value is `venue_id` = APR Villas, `unit_label` = `Clubhouse` →
"Adarsh Palm Retreat Villas — Clubhouse".

## Maps link in WhatsApp

Every location-bearing message gets `https://maps.google.com/?q=<lat>,<lng>`
appended to `location_str`. WhatsApp linkifies it in the body, so it works on
the quick-reply templates (`coach_before_class`, `coach_arrival_check`) where a
proper URL button can't sit alongside the Yes/No buttons. No Meta re-approval.

The app already has this via `NavigateButton.tsx`.

> The `notify` edge function has **no autodeploy**. The label change alone needs
> none (it reads `location_label` as a computed field), but the maps link
> changes worker code — `supabase functions deploy notify` or prod drifts.

## Definition of done

- `npm run test:db` green, `tests/db/venue-label.test.ts` rewritten against the
  stored model.
- `lib/venue-display.test.ts` ladder cases deleted; unit composition covered.
- `supabase/schema.sql` regenerated and committed with the migration.
- No caller derives a location from an address string.
