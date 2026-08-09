-- A coach at a school should see that school's pupils.
--
-- Until now /coach/players was built strictly from `bookings` on the coach's
-- own sessions, and `players` RLS agreed: `coach_has_player()` is true only
-- where a booking already links the pupil to a session this coach is on. For a
-- school class that is too narrow. `add_school_player` books a new pupil onto
-- the class's sessions *from the session they were added to onwards*, so a
-- coach who picks the class up later — a cover, a term-time swap, a second
-- coach on the same campus — sees a roster that is missing pupils they will be
-- standing in front of on the day.
--
-- The wider rule is still a fact about the coach's own diary, not a blanket
-- grant: a coach may read the pupils of a campus where they are actually
-- rostered onto a school class. `client_id is null` keeps it to school pupils —
-- a private client's child who happens to attend that school stays out, the
-- same line `is_school_admin` draws (0062).

CREATE OR REPLACE FUNCTION public.coach_teaches_school_of(p_player uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from players p
    join classes c
      on c.is_school and c.venue_id = p.school_venue_id
    join class_sessions s
      on s.class_id = c.id and s.coach_id = auth.uid()
    where p.id = p_player
      and p.school_venue_id is not null
      and p.client_id is null
  );
$function$;

comment on function public.coach_teaches_school_of is
  'True when the player is a pupil of a campus where this coach is rostered onto a school class. The read-side twin of coach_has_player, one step wider: the campus, not the individual booking.';

-- Venues where this coach is rostered onto a school class. The roster screen
-- needs the same set the policy implies, and a coach cannot read `classes` and
-- `class_sessions` widely enough to derive it in one PostgREST query.
CREATE OR REPLACE FUNCTION public.coach_school_venues()
 RETURNS TABLE(venue_id uuid, venue_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct v.id, v.name
  from class_sessions s
  join classes c on c.id = s.class_id and c.is_school
  join venues v on v.id = c.venue_id
  where s.coach_id = auth.uid();
$function$;

comment on function public.coach_school_venues is
  'Campuses where the signed-in coach is rostered onto a school class. Drives the school half of /coach/players.';

CREATE POLICY "coach reads school pupils" ON public.players
  AS PERMISSIVE FOR SELECT TO public
  USING (( SELECT is_coach() AS is_coach) AND coach_teaches_school_of(id));
