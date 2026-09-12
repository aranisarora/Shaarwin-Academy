-- School classes: group classes held at a school or university where attendees
-- do NOT book through the site. Coaches and admins add players directly, and
-- those players have no account holder (client).

-- A group class flagged as a school class.
alter table public.classes add column is_school boolean not null default false;

-- School players have no account holder and carry their school (a venue) + grade.
alter table public.players alter column client_id drop not null;
alter table public.players add column school_venue_id uuid references public.venues(id) on delete set null;
alter table public.players add column grade smallint;

-- School enrolments (weekly series + per-session bookings) also lack a client.
alter table public.booking_series alter column client_id drop not null;
alter table public.bookings alter column client_id drop not null;

-- Public listing must not expose school classes — there is no public booking.
drop policy if exists "public reads active group classes" on public.classes;
create policy "public reads active group classes" on public.classes
  as permissive for select to public
  using (
    (((active = true) and (class_type = 'group'::class_type) and (is_school = false))
     or is_founder()
     or (is_coach() and coach_teaches_class(id))
     or client_owns_private_class(id))
  );

-- Add a school player to a school class and enrol them across its sessions.
-- SECURITY DEFINER so a coach (who can't normally insert players/bookings) can
-- add the walk-in attendees only they know about — authorised to the founder or
-- the coach assigned to the given session, and only for school classes.
create or replace function public.add_school_player(
  p_session uuid,
  p_full_name text,
  p_grade smallint
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_class     classes%rowtype;
  v_start     timestamptz;
  v_player    uuid;
  v_series    uuid;
  v_weekday   int;
  v_time      time;
  v_dob       date;
begin
  select cs.starts_at into v_start from class_sessions cs where cs.id = p_session;
  if not found then raise exception 'session not found'; end if;
  select c.* into v_class
  from class_sessions cs join classes c on c.id = cs.class_id
  where cs.id = p_session;
  if not v_class.is_school then raise exception 'not a school class'; end if;

  if not (is_founder() or exists (
      select 1 from class_sessions cs
      where cs.id = p_session and cs.coach_id = v_uid)) then
    raise exception 'not authorised';
  end if;

  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'name required';
  end if;

  -- Approximate DOB from grade: an Indian Grade N pupil is roughly N + 5 years old.
  if p_grade is not null then
    v_dob := make_date(extract(year from now())::int - (p_grade + 5), 1, 1);
  end if;

  insert into players (client_id, full_name, date_of_birth, grade, school_venue_id, skill_level)
  values (null, btrim(p_full_name), v_dob, p_grade, v_class.venue_id, 'beginner')
  returning id into v_player;

  -- Weekly series so future generated sessions pick them up automatically.
  v_weekday := extract(isodow from (v_start at time zone 'Asia/Kolkata'))::int;
  v_time    := (v_start at time zone 'Asia/Kolkata')::time;
  insert into booking_series (client_id, player_id, class_id, weekday, start_time)
  values (null, v_player, v_class.id, v_weekday, v_time)
  returning id into v_series;

  -- Book this session and every future scheduled session of the class now.
  insert into bookings (session_id, client_id, player_id, status, series_id)
  select cs.id, null, v_player, 'confirmed', v_series
  from class_sessions cs
  where cs.class_id = v_class.id
    and cs.status = 'scheduled'
    and cs.starts_at >= v_start;

  return v_player;
end;
$function$;

grant execute on function public.add_school_player(uuid, text, smallint) to authenticated;
