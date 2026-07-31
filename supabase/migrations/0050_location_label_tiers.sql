-- 0049 resolved a private's location by exact venue-address match alone. That
-- fixed the big case (132 of 167 privates) but left 22 sessions labelled with
-- things like "Bengaluru, 560103, India" — a label that names a city of 14
-- million and helps nobody — and it duplicated a weaker copy of the resolver in
-- lib/venue-display.ts.
--
-- Two things changed the design:
--
-- 1. DISTANCE IS NOT USABLE HERE. The TypeScript resolver's "nearest venue
--    within ~150m" tier is unsafe on this book: APR Tower 1 and APR Villas are
--    36 METRES apart, and four APR venues sit within 1.3km. The academy runs
--    several distinct venues inside one complex, so any radius wide enough to
--    catch a villa is wide enough to name the wrong building. That tier is gone
--    from both implementations, not reimplemented here.
--
-- 2. MAPBOX ALREADY TELLS US THE COMPLEX. Reverse-geocoding all four APR pins
--    returns locality = "Adarsh Palm Retreat" for the three inside the complex.
--    Mapbox cannot tell the villas from the towers — but for a label it does not
--    need to: "Adarsh Palm Retreat" is what the coach and the parent call it,
--    and the flat/tower detail is already on the session page. The wizard has
--    been storing this in address_details.locality all along (53 of the 57 rows
--    that have address_details at all).
--
-- Resolution order, and why each tier sits where it does:
--
--   1. venues.name via classes.venue_id     — a real venue booking always wins
--   2. venues.name via exact address match  — a private AT a known venue
--   3. address_details.name                 — the geocoded POI ("Windmills of
--                                             your mind, Back Gate")
--   4. first address segment, IF INFORMATIVE — a home private needs its street;
--                                             "Prestige Mayberry Road 34" beats
--                                             the neighbourhood it sits in
--   5. address_details.locality             — the rescue for when the address
--                                             head is junk ("Bengaluru", "Phase 3")
--   6. the address head, then the raw address — last resorts
--
-- Tier 4 before tier 5 is deliberate and was measured: putting locality first
-- improved 34 labels but REGRESSED 6, turning "Prestige Mayberry Road 34" into
-- "Chansandra". Ordered this way, all 40 changed labels improve and none regress.

-- Split on both the ASCII comma and U+060C ARABIC COMMA. A third of the
-- addresses on the book are geocoded with the Arabic comma, and an ASCII-only
-- split hands back the entire address as one "segment" — which is how
-- "Phase 3 ، 560035 Bengaluru، India" looked informative.
CREATE OR REPLACE FUNCTION public.address_head(p_address text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(btrim(split_part(replace(coalesce(p_address, ''), U&'\060C', ','), ',', 1)), '');
$function$;

-- Is this address segment worth showing on its own? Rejects the segments that
-- name no place a coach could drive to: pure numbers ("51/3"), the city/state/
-- country, and bare sub-unit designators inside a complex ("Phase 3", "Lane 1",
-- "Sy No 36/3") which are meaningless without the complex name.
CREATE OR REPLACE FUNCTION public.is_informative_place(p_segment text, p_city text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_segment is not null
     and p_segment ~ '[A-Za-z]'
     and lower(p_segment) not in ('india', 'bengaluru', 'bangalore', 'karnataka')
     and lower(p_segment) is distinct from lower(coalesce(p_city, ''))
     and p_segment !~* '^(phase|lane|block|tower|wing|sector|sy\.?\s*no|survey\s*no)[\s.:-]*[0-9a-z/-]{0,6}$';
$function$;

CREATE OR REPLACE FUNCTION public.location_label(c public.classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    -- 1. A real venue booking.
    (select v.name from venues v where v.id = c.venue_id),
    -- 2. A private whose address IS a venue's address.
    (select v.name
       from private_class_details pcd
       join venues v
         on lower(regexp_replace(btrim(v.address), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(pcd.address), '\s+', ' ', 'g'))
      where pcd.class_id = c.id
        and btrim(coalesce(pcd.address, '')) <> ''
      order by v.active desc, v.name
      limit 1),
    -- 3-6. Everything the geocoder gave us, best first.
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

COMMENT ON FUNCTION public.location_label(public.classes) IS
  'Human-readable location for a class: venue name, else the venue whose address matches a private''s address, else the geocoded POI name, else the street, else the locality. Mirrors makeVenueResolver in lib/venue-display.ts. Exposed by PostgREST as a computed field on classes.';
