-- A school should see its own campus.
--
-- The other half of the hole 0079 closed for coaches. `venues.active` is a
-- booking flag, every campus is inactive because a campus is not something a
-- client books, and the only read policy on the table was
-- `active = true OR is_founder()`. So a school account could not read the one
-- venue row that is entirely about it.
--
-- The symptom is quieter than the coach one and therefore lasted longer:
-- getCampuses() embeds `venues(name,unit)` off `school_admins` and falls back to
-- `row.venues?.name ?? "School"`. With the row unreadable the embed is null and
-- the fallback swallows it, so all 9 school accounts in production see their
-- campus called literally "School" — on the More screen, and in the title bar
-- via campusLabel(). Meanwhile they can read the 20 *active* venues they have
-- nothing to do with. Their own was the only one hidden.
--
-- No new helper: `school_admin_venues()` (0062) already answers exactly this,
-- and it is the same set the pupil policies are written against, so the campus
-- a school can name and the pupils it can read cannot drift apart.

CREATE POLICY "school reads own campus" ON public.venues
  AS PERMISSIVE FOR SELECT TO public
  USING ((id IN ( SELECT school_admin_venues() AS school_admin_venues)));
