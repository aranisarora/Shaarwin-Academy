-- A coach should see the venue they are standing in.
--
-- `venues.active` is a *booking* flag: switching it off takes a venue out of
-- what a client can book, and nothing more. The schools are all `active = false`
-- for exactly that reason — they are managed internally, not booked — and every
-- one of them carries good coordinates.
--
-- But the only read policy on `venues` was `active = true OR is_founder()`, so
-- PostgREST silently handed a coach a NULL for every school venue. Measured in
-- production on 2026-08-11: 8 of 11 logged proximity attempts returned
-- `no_venue` and every one of them was a school class, while all 3 attempts at a
-- non-school venue got a fix. The venue rows were never missing and their
-- coordinates were never missing — the coach just could not read them. 239 of
-- the 563 sessions in the last 30 days (42%) sit behind that policy, so
-- geofenced auto-arrival was structurally unable to fire on any of them.
--
-- It is not only the fence. `location_venue()` is invoker-rights and reads
-- `venues`, so `classes.location_label` came back NULL through the same hole:
-- a coach opening a school session saw a blank where the campus name should be.
--
-- The grant stays a fact about the coach's own diary rather than a blanket
-- read, which is the line 0076 drew for school pupils: a coach may read a venue
-- where they are actually rostered onto a session. Nothing here widens what a
-- client sees — `active` still governs that, untouched.

CREATE OR REPLACE FUNCTION public.coach_is_rostered_at(p_venue uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from class_sessions s
    join classes c on c.id = s.class_id
    where s.coach_id = auth.uid()
      and c.venue_id = p_venue
  );
$function$;

comment on function public.coach_is_rostered_at is
  'True when the signed-in coach is rostered onto any session held at this venue. Deliberately not limited to school venues or to future sessions: it answers "is this one of my venues", which is the same question the address, the access notes and the arrival geofence all ask.';

-- Additive: "public reads active venues" is left exactly as it is, so a client
-- still sees active venues only and an inactive venue stays unbookable.
CREATE POLICY "coach reads rostered venues" ON public.venues
  AS PERMISSIVE FOR SELECT TO public
  USING ((( SELECT is_coach() AS is_coach)) AND coach_is_rostered_at(id));
