-- A school gets a login. Step two: who they are linked to, and what they read.
--
-- Scope, decided by the owner and enforced here rather than in the UI:
--
--   * READ-ONLY. Not one policy below grants insert, update or delete. Pupils
--     keep being added by coaches through `add_school_player`.
--   * Only account-less school pupils — `school_venue_id` set AND `client_id`
--     null. A private client's child who happens to train on the same campus is
--     never visible to the school. `add_school_player` is the only writer of
--     `school_venue_id` and it always leaves `client_id` null, so the second
--     half of that test is belt-and-braces: it makes the boundary explicit
--     instead of incidental, and it holds even if a pupil is later adopted into
--     a parent account.
--
-- Reads go through WIDENED RLS rather than new definer-rights RPCs. The school
-- sees exactly what a parent sees, so routing it through the same policies lets
-- `getStudentInsights`, `getMasteryMap` and `get_player_notes` serve both
-- audiences unchanged — one definition of "attendance", not two that drift.
-- The new policies are separate and PERMISSIVE, so they OR with what is already
-- there and no existing policy is edited.

-- ── The link ────────────────────────────────────────────────────────────────
-- Many-to-many on purpose, though the founder UI creates exactly one row per
-- school today. It is what lets a head cover two campuses, or a school hold a
-- second per-person login later, without another migration.
create table if not exists public.school_admins (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  venue_id   uuid not null references public.venues(id)   on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now() not null,
  primary key (user_id, venue_id)
);

create index if not exists school_admins_venue_idx on public.school_admins (venue_id);

alter table public.school_admins enable row level security;

drop policy if exists "founder all school admins" on public.school_admins;
create policy "founder all school admins" on public.school_admins
  for all using ((select is_founder()));

-- The school reads its own link rows — that is how the app resolves which
-- campus it is looking at.
drop policy if exists "school reads own link" on public.school_admins;
create policy "school reads own link" on public.school_admins
  for select using (user_id = (select auth.uid()));

-- ── Authorisation helpers ───────────────────────────────────────────────────
-- Definer-rights and stable, mirroring is_coach() / coach_has_player().

create or replace function public.is_school_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'school'
  );
$$;

-- The caller's campuses. Split out so every check below reads the same way.
create or replace function public.school_admin_venues()
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select venue_id from school_admins where user_id = auth.uid();
$$;

create or replace function public.school_has_player(p_player uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from players pl
    where pl.id = p_player
      and pl.client_id is null
      and pl.school_venue_id in (select school_admin_venues())
  );
$$;

-- A session one of my pupils is booked into, and the class behind it. Keyed on
-- the booking rather than on the class's venue so a pupil's whole attendance
-- history stays legible even if their school class is ever moved or merged.
create or replace function public.school_admin_session(p_session uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from bookings b
      join players pl on pl.id = b.player_id
     where b.session_id = p_session
       and pl.client_id is null
       and pl.school_venue_id in (select school_admin_venues())
  );
$$;

create or replace function public.school_admin_class(p_class uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from bookings b
      join players pl on pl.id = b.player_id
      join class_sessions cs on cs.id = b.session_id
     where cs.class_id = p_class
       and pl.client_id is null
       and pl.school_venue_id in (select school_admin_venues())
  );
$$;

-- ── The four reads ──────────────────────────────────────────────────────────

drop policy if exists "school reads own pupils" on public.players;
create policy "school reads own pupils" on public.players
  for select using ((select is_school_admin()) and school_has_player(id));

-- Required, not optional: school pupils carry `client_id = null`, so the
-- "clients read own bookings" policy matches nothing for them and every
-- attendance figure would come back zero without this.
drop policy if exists "school reads pupil bookings" on public.bookings;
create policy "school reads pupil bookings" on public.bookings
  for select using ((select is_school_admin()) and school_has_player(player_id));

drop policy if exists "school reads pupil sessions" on public.class_sessions;
create policy "school reads pupil sessions" on public.class_sessions
  for select using ((select is_school_admin()) and school_admin_session(id));

-- getStudentInsights joins classes(title, class_type) off the session.
drop policy if exists "school reads pupil classes" on public.classes;
create policy "school reads pupil classes" on public.classes
  for select using ((select is_school_admin()) and school_admin_class(id));

-- ── The two definer-rights reads parents already use ────────────────────────
-- Both gain the same branch. Bodies are otherwise unchanged.

create or replace function public.get_player_notes(p_player uuid)
returns table(id uuid, body text, created_at timestamptz, author_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (
    is_coach() or is_founder()
    or exists (
      select 1 from players pl
       where pl.id = p_player and pl.client_id = auth.uid()
    )
    or (is_school_admin() and school_has_player(p_player))
  ) then
    raise exception 'not_authorised';
  end if;

  return query
    select n.id, n.body, n.created_at,
           coalesce(nullif(trim(p.full_name), ''), 'Coach') as author_name
      from student_notes n
      left join profiles p on p.id = n.author_id
     where n.player_id = p_player
     order by n.created_at desc;
end;
$function$;

create or replace function public.get_players_mastery(p_players uuid[])
returns table(player_id uuid, mastery integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  with authorized as (
    select pl.id from players pl
    where pl.id = any(p_players)
      and (
        is_founder()
        or (is_coach() and coach_has_player(pl.id))
        or pl.client_id = auth.uid()
        or (is_school_admin() and school_has_player(pl.id))
      )
  ),
  n_skills as (select count(*)::int as n from skills where active),
  latest as (
    select distinct on (a.player_id, r.skill_id)
           a.player_id, r.skill_id, r.rating
      from skill_ratings r
      join skill_assessments a on a.id = r.assessment_id
      join skills s on s.id = r.skill_id and s.active
     order by a.player_id, r.skill_id, a.created_at desc
  )
  select au.id,
         case when (select n from n_skills) = 0 then 0
              else round(100.0 * coalesce(sum(l.rating), 0)
                         / (5 * (select n from n_skills)))::int
         end
    from authorized au
    left join latest l on l.player_id = au.id
   group by au.id;
$function$;

-- ── Provisioning ────────────────────────────────────────────────────────────
-- The founder creates a school login with the admin API, passing the campus in
-- user metadata. Branching here rather than cleaning up afterwards keeps ONE
-- provisioning path: `lib/auth.ts` documents that a signed-in user without a
-- profile row is a bug to surface, not to paper over, and that only holds while
-- this trigger is the single place a profile is born.
--
-- Ordered above the coach-invite branch: an explicit school_venue_id is a
-- direct instruction, a matching coach invite is a coincidence.
--
-- The other two triggers on profiles need no change — `profiles_grant_trial`
-- carries `WHEN (new.role = 'client')`, and `ops_notify_new_profile` already
-- no-ops for any role it doesn't name.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name   text := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_school uuid := nullif(new.raw_user_meta_data->>'school_venue_id', '')::uuid;
  v_invite public.coach_invites%rowtype;
begin
  if v_school is not null then
    insert into profiles (id, role, full_name, email, approval_status)
    values (new.id, 'school', v_name, new.email, 'approved')
    on conflict (id) do nothing;

    insert into school_admins (user_id, venue_id)
    values (new.id, v_school)
    on conflict do nothing;

    -- Deliberately no player row: a school is not a household.
    return new;
  end if;

  select * into v_invite
  from public.coach_invites
  where lower(email) = lower(new.email)
    and claimed_at is null
  order by created_at
  limit 1;

  if found then
    insert into profiles (id, role, full_name, email, phone, approval_status)
    values (
      new.id,
      'coach',
      coalesce(nullif(v_invite.full_name, ''), v_name),
      new.email,
      v_invite.phone,
      'approved'
    )
    on conflict (id) do nothing;

    insert into coaches (
      id, bio, base_lat, base_lng, base_address, active
    )
    values (
      new.id, v_invite.bio,
      coalesce(v_invite.base_lat, 12.9716),
      coalesce(v_invite.base_lng, 77.5946),
      v_invite.base_address,
      true
    )
    on conflict (id) do nothing;

    update public.coach_invites
    set claimed_at = now(), claimed_by = new.id
    where id = v_invite.id;

    return new;
  end if;

  insert into profiles (id, role, full_name, email, approval_status)
  values (new.id, 'client', v_name, new.email, 'pending')
  on conflict (id) do nothing;

  insert into players (client_id, full_name)
  select new.id, v_name
  where not exists (select 1 from players where client_id = new.id);

  return new;
end;
$function$;
