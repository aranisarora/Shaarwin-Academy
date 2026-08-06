-- Whether a venue is a school is now something the founder says, not something
-- the app infers. Until today the Schools tab was derived from `classes` where
-- is_school = true, collapsed by venue — so a campus "became" a school the
-- moment someone published a School class there, and stopped being one the
-- moment that class was deleted, taking its login off the screen while the
-- account carried on working. There was no control anywhere to say it plainly.
--
-- Default false: a venue is an ordinary place we coach at unless told otherwise.

alter table public.venues
  add column if not exists is_school boolean not null default false;

-- Backfill from what the old derivation already believed, so nothing that shows
-- in the Schools tab today disappears from it tomorrow.
update public.venues v
   set is_school = true
 where exists (
   select 1 from public.classes c
    where c.venue_id = v.id and c.is_school
 );

-- A venue that already has a school login is a school by definition, even if
-- its last school class has since been deleted. This is the stranded case the
-- old derivation could not see.
update public.venues v
   set is_school = true
 where exists (
   select 1 from public.school_admins sa where sa.venue_id = v.id
 );
