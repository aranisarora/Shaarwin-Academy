-- `venues.active` says what it does now: is_public.
--
-- The name cost us a production bug. `active` reads as "this row is live", so
-- the only read policy on the table was written as `active = true OR
-- is_founder()` — and because every campus is deliberately not public, that
-- quietly made schools unreadable to the coaches standing in them. 0079 and 0080
-- fixed the policies. This fixes the reason anyone wrote them that way.
--
-- What the flag actually governs, both halves:
--
--   * whether the venue is listed on the public website  (lib/data.ts getVenues,
--     which feeds NearbyVenues and VenueMap), and
--   * whether a client can pick it when booking            (app/app/book/private).
--
-- So it is not `bookable` — that names only the second half, and the first
-- person to flip it would be surprised when the venue also left the website.
-- `is_public` covers both, and it is named from the public side on purpose:
-- `is_private` would collide with the `private` this codebase already uses for
-- 1:1 sessions at a client's home (class_type = 'private', private_class_details,
-- private_booking_series), which do not happen at venues at all.
--
-- Renaming a column is transparent to policies — Postgres stores their
-- expressions parsed, by attnum — so the USING clause follows automatically and
-- only the policy's *name* needs saying again. Checked before writing this: no
-- function body in `public` references venues.active (the `active` in
-- rank_coaches, ops_notify_class_open and wipe_calendar all belong to coaches,
-- classes and booking_series), so nothing stored as text breaks.

alter table public.venues rename column active to is_public;

alter policy "public reads active venues" on public.venues
  rename to "public reads public venues";

comment on column public.venues.is_public is
  'Whether this venue is offered to clients: listed on the public website AND pickable when booking. False for the campuses, which are managed internally — a school is not somewhere a member of the public turns up. Not a visibility flag for staff: coaches and school accounts read the venues that concern them through their own policies (0079, 0080).';
