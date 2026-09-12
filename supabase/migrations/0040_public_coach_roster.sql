-- The public /coaches page and the private-booking coach picker both read the
-- roster as `coaches` joined to `profiles` for the coach's name. `profiles` is
-- only readable by its owner or the founder, so that inner join returned zero
-- rows for anonymous visitors and for logged-in clients alike — the coaches
-- page fell back to its empty state and the booking wizard offered no coaches.
--
-- Widening the `profiles` RLS policy would expose coach emails, phone numbers
-- and billing ids, so instead expose a definer-rights function that projects
-- only the fields already meant to be public. `coaches` itself is public-read
-- for active rows (see "public reads active coaches"), so the only column this
-- adds beyond that policy is `full_name`.
create or replace function public.public_coach_roster()
returns table (
  id uuid,
  full_name text,
  bio text,
  quote text,
  credentials text[],
  photo_url text,
  base_lat double precision,
  base_lng double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, p.full_name, c.bio, c.quote, c.credentials, c.photo_url,
         c.base_lat, c.base_lng
  from public.coaches c
  join public.profiles p on p.id = c.id
  where c.active
    and p.deleted_at is null
  order by c.created_at
$$;

revoke all on function public.public_coach_roster() from public;
grant execute on function public.public_coach_roster() to anon, authenticated;
