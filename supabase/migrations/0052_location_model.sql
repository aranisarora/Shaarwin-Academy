-- One location model for every class: venue + unit, chosen by a human at
-- booking and stored. Replaces the six-tier resolver that parsed a display name
-- out of a geocoded address string at read time (0049/0050/0051).
--
-- See docs/plans/location-model.md. The short version: the admin add sheet
-- already picked a venue from a dropdown and threw the id away, copying the
-- venue's address onto the private instead — 110 of 167 privates were a known
-- venue_id laundered into a string and then parsed back out of it.
--
-- Three parts, composed as "<name> <venue unit>, <session unit>":
--
--   Adarsh Palm Retreat Villas, Clubhouse
--   Adarsh Palm Retreat Apartments, Clubhouse
--   Embassy Pristine Apartment, Tower 1 flat 171
--
-- The venue unit is a SAFETY field, not decoration. Within one complex the
-- villas' clubhouse and the apartments' clubhouse are mutually inaccessible —
-- a coach told "APR, Clubhouse" has even odds of standing at a gate that won't
-- open. location_label always composes the full venue_display (which carries
-- venues.unit) before appending the session's own unit, so a unit can never be
-- shown without the venue detail that disambiguates it.
--
-- This migration is additive: location_venue still falls back to the old ladder
-- for rows the backfill (0053) hasn't filled yet, so no message regresses in
-- between. 0053 removes that fallback and drops address_head /
-- is_informative_place.

-- Which part of a complex has the tables. Null for a venue that IS the whole
-- place. Required (in the venue manager) once a complex has more than one row,
-- so a bare "Adarsh Palm Retreat" is never selectable.
alter table public.venues add column if not exists unit text;

-- For privates at somewhere that isn't a saved venue. When venue_id is set,
-- venue_label stays null and the venue row is the source of truth — renaming
-- "La Palazzo " then fixes every message, past and future, instead of leaving
-- 37 frozen copies of the typo.
alter table public.private_class_details
  add column if not exists venue_label text,
  add column if not exists unit_label text;

comment on column public.venues.unit is
  'Sub-location within a complex ("Villas", "Apartments"). Required when another venue shares this name — see location_label().';
comment on column public.private_class_details.venue_label is
  'The place you drive to, for privates with no venue_id. Prefer attaching a venue_id.';
comment on column public.private_class_details.unit_label is
  'Where inside the venue ("Clubhouse", "Villa 659", "Tower 1 flat 171").';

-- "Adarsh Palm Retreat" + "Villas" -> "Adarsh Palm Retreat Villas". The unit
-- reads as a suffix of the name, so it joins with a space; the session's own
-- unit joins with a comma (below) to stay legible inside a message that already
-- uses an em dash between the time and the place.
CREATE OR REPLACE FUNCTION public.venue_display(v venues)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select btrim(v.name) || coalesce(' ' || nullif(btrim(v.unit), ''), '');
$function$;

-- The place you drive to, alone — for grouping and sorting, where the flat
-- number would only add noise.
CREATE OR REPLACE FUNCTION public.location_venue(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select venue_display(v) from venues v where v.id = c.venue_id),
    (select nullif(btrim(pcd.venue_label), '')
       from private_class_details pcd where pcd.class_id = c.id),
    -- Transitional only: rows the 0053 backfill hasn't reached keep their old
    -- derived label rather than falling to null. Both tiers dropped in 0053.
    --
    -- This exact-address match is what the admin dropdown's copied venue
    -- address lands on — 110 of 167 privates. Dropping it (as the first cut of
    -- this migration did) silently regresses them to "47/1", "Lane-1 Phase-1"
    -- and "24th Main Rd". It stays until 0053 gives those rows a real venue_id.
    (select venue_display(v)
       from private_class_details pcd
       join venues v
         on lower(regexp_replace(btrim(v.address), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(pcd.address), '\s+', ' ', 'g'))
      where pcd.class_id = c.id
        and btrim(coalesce(pcd.address, '')) <> ''
      order by v.active desc, v.name
      limit 1),
    (select coalesce(
              nullif(btrim(pcd.address_details->>'name'), ''),
              case when is_informative_place(address_head(pcd.address),
                                             pcd.address_details->>'city')
                   then address_head(pcd.address) end,
              nullif(btrim(pcd.address_details->>'locality'), ''),
              address_head(pcd.address),
              nullif(btrim(pcd.address), '')
            )
       from private_class_details pcd where pcd.class_id = c.id)
  );
$function$;

-- Where inside the venue. Group classes have no private_class_details, so the
-- venue's own unit is the whole answer for them.
CREATE OR REPLACE FUNCTION public.location_unit(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select nullif(btrim(pcd.unit_label), '')
    from private_class_details pcd where pcd.class_id = c.id;
$function$;

-- The one string every message uses. Null venue short-circuits to null so a
-- caller's coalesce to the raw address still fires.
CREATE OR REPLACE FUNCTION public.location_label(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select location_venue(c) || coalesce(', ' || location_unit(c), '');
$function$;

-- Directions for whoever reads the message — the fallback when a name still
-- isn't enough. Read as a PostgREST computed field by the notify worker.
--
-- The private's own pin wins over its venue's, deliberately: coach_mark_arrival
-- geofences a private against private_class_details.lat/lng and only falls back
-- to the venue for group classes. A map pointing anywhere else would send a
-- coach to a spot that then fails the arrival check.
CREATE OR REPLACE FUNCTION public.location_maps_url(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select 'https://maps.google.com/?q=' || coalesce(
    (select pcd.lat::text || ',' || pcd.lng::text
       from private_class_details pcd where pcd.class_id = c.id),
    (select v.lat::text || ',' || v.lng::text
       from venues v where v.id = c.venue_id)
  );
$function$;
