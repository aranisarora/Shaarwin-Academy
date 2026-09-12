-- Backfill the location model from 0052, then delete the ladder it replaces.
--
-- Every private ends up with either a venue_id (preferred — a rename then fixes
-- every message, past and future) or a stored venue_label. Nothing is derived
-- from an address string afterwards, so address_head() and
-- is_informative_place() go with it.
--
-- Founder decisions behind the judgement calls here (31 Jul 2026), recorded
-- because no query can re-derive them:
--   * "APR Tower 1" and "APR Apartments" are the same physical place.
--   * The 5 sessions carrying building "Apr Apartment" / floorTower "tower 4" /
--     flat "clubhouse" are the VILLAS' clubhouse. The geocoded POI was right and
--     the typed building was wrong. Villa residents cannot enter the towers'
--     clubhouse and vice versa, so this is a wrong-gate safety bug, not a
--     cosmetic one.
--   * "Windmills of your mind, Back Gate" (297m from the saved venue) is the
--     same venue, entered from the back gate.
--   * "Prestige Mayberry Road 34" becomes a real venue.

-- ---------------------------------------------------------------- venues ----

-- Adarsh Palm Retreat was four rows. The rows stay (each holds its own pin, and
-- coach_mark_arrival geofences group classes against it — APR Apartments' pin is
-- ~1.3km from Tower 1's), but they now share one name and differ by unit. That
-- is the "merge" without moving a geofence under the 2 live group classes.
update public.venues set name = 'Adarsh Palm Retreat', unit = 'Apartments' where name = 'APR Apartments';
update public.venues set name = 'Adarsh Palm Retreat', unit = 'Villas'     where name = 'APR Villas';
update public.venues set name = 'Adarsh Palm Retreat', unit = 'Lakefront'  where name = 'APR lakefront';

-- Same place as Apartments, and provably unreferenced: 0 classes, 0 privates
-- matching its address, 0 players keyed to it as a school.
delete from public.venues
 where name = 'APR Tower 1'
   and not exists (select 1 from classes c where c.venue_id = venues.id)
   and not exists (select 1 from players p where p.school_venue_id = venues.id);

-- The one genuine standalone on the book, promoted so it behaves like every
-- other complex and appears in the booking picker. The venue address is the
-- road, not the unit — the unit lives on the session.
insert into public.venues (name, address, postcode, lat, lng, active)
select 'Prestige Mayberry', 'Prestige Mayberry Road, Bengaluru, 560067, India',
       '560067', 12.979645, 77.75854, true
where not exists (select 1 from public.venues where name = 'Prestige Mayberry');

-- Cosmetic, and free now that venue_display() btrims: the stored name keeps its
-- trailing space otherwise, which defeats any future exact-name comparison.
update public.venues set name = btrim(name) where name <> btrim(name);

-- -------------------------------------------------------------- privates ----

-- 1. The 126 privates the admin add sheet created by copying a venue's address.
--    This is the id that sheet already had in hand and threw away.
update public.classes c
   set venue_id = v.id
  from public.private_class_details pcd
  join public.venues v
    on lower(regexp_replace(btrim(v.address), '\s+', ' ', 'g'))
     = lower(regexp_replace(btrim(pcd.address), '\s+', ' ', 'g'))
 where pcd.class_id = c.id
   and c.venue_id is null
   and btrim(coalesce(pcd.address, '')) <> '';

-- 2. Privates whose geocoded POI or typed building names a venue we already
--    hold. Matched on the venue's display name so the APR rows renamed above
--    are reachable by their old POI text.
update public.classes c
   set venue_id = v.id
  from public.private_class_details pcd, public.venues v
 where pcd.class_id = c.id
   and c.venue_id is null
   and lower(btrim(v.name || coalesce(' ' || v.unit, ''))) = any (array[
         lower(btrim(coalesce(pcd.address_details->>'name', ''))),
         lower(btrim(coalesce(pcd.address_details->>'building', '')))
       ]);

-- 3. Named by hand (founder, above). Keyed on the geocoded payload rather than
--    class ids so this migration is reproducible against a fresh restore.
update public.classes c
   set venue_id = (select id from public.venues where name = 'Windmills Of Your Mind' limit 1)
  from public.private_class_details pcd
 where pcd.class_id = c.id and c.venue_id is null
   and pcd.address_details->>'name' = 'Windmills of your mind, Back Gate';

update public.classes c
   set venue_id = (select id from public.venues where name = 'Embassy Pristine Apartment' limit 1)
  from public.private_class_details pcd
 where pcd.class_id = c.id and c.venue_id is null
   and lower(btrim(coalesce(pcd.address_details->>'building', ''))) = 'embassy pristine';

update public.classes c
   set venue_id = (select id from public.venues where name = 'Prestige Mayberry' limit 1)
  from public.private_class_details pcd
 where pcd.class_id = c.id and c.venue_id is null
   and pcd.address_details->>'locality' = 'Chansandra';

-- 4. The unit: where inside the venue. Composed from the structured fields the
--    client already filled — a bare number reads as a flat, anything else
--    (Villa 659, clubhouse) is already a noun.
--
--    Only the first character of the whole phrase is capitalised, so "flat"
--    leads as "Flat 4092" but reads as prose mid-phrase ("Tower 1, flat 171").
update public.private_class_details pcd
   set unit_label = (
     select upper(left(u, 1)) || substr(u, 2)
       from (
         select nullif(concat_ws(', ',
           nullif(btrim(coalesce(pcd.address_details->>'floorTower', '')), ''),
           case
             when nullif(btrim(coalesce(pcd.address_details->>'flat', '')), '') is null then null
             when btrim(pcd.address_details->>'flat') ~ '^[0-9]+$'
               then 'flat ' || btrim(pcd.address_details->>'flat')
             else btrim(pcd.address_details->>'flat')
           end
         ), '') as u
       ) t
   )
 where pcd.address_details is not null
   and pcd.unit_label is null;

-- The villas' clubhouse. The typed "Apr Apartment" / "tower 4" are wrong (see
-- header) and would send a coach to a gate that won't open for them.
update public.private_class_details pcd
   set unit_label = 'Clubhouse'
 where lower(btrim(coalesce(pcd.address_details->>'flat', ''))) = 'clubhouse';

-- The villas' POI already says "Villas", which the venue unit now carries, so
-- the session unit is just the villa number.
update public.private_class_details pcd
   set unit_label = 'Villa ' || btrim(pcd.address_details->>'flat')
 where pcd.address_details->>'name' = 'Adarsh Palm Retreat Villas'
   and btrim(coalesce(pcd.address_details->>'flat', '')) ~ '^[0-9]+$';

-- Which gate is the whole point of attaching these to the main venue: the pin
-- is 297m from it, so a coach reading only "Windmills Of Your Mind" drives to
-- the wrong entrance.
update public.private_class_details pcd
   set unit_label = 'Back gate, ' || lower(unit_label)
 where pcd.address_details->>'name' = 'Windmills of your mind, Back Gate'
   and unit_label is not null
   and unit_label not ilike 'back gate%';

-- 5. Anything still unattached keeps a stored label rather than falling to
--    null when the ladder is dropped below. Expected to affect 0 rows; kept so
--    a restore with unfamiliar data degrades to a name instead of nothing.
update public.private_class_details pcd
   set venue_label = coalesce(
         nullif(btrim(pcd.address_details->>'name'), ''),
         nullif(btrim(pcd.address_details->>'building'), ''),
         nullif(btrim(pcd.address_details->>'locality'), ''),
         nullif(btrim(pcd.address), '')
       )
 where pcd.venue_label is null
   and not exists (
     select 1 from public.classes c
      where c.id = pcd.class_id and c.venue_id is not null
   );

-- ------------------------------------------------------- drop the ladder ----

-- No transitional tiers left: every private has a venue_id or a venue_label.
CREATE OR REPLACE FUNCTION public.location_venue(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select venue_display(v) from venues v where v.id = c.venue_id),
    (select nullif(btrim(pcd.venue_label), '')
       from private_class_details pcd where pcd.class_id = c.id)
  );
$function$;

drop function if exists public.is_informative_place(text, text);
drop function if exists public.address_head(text);
