-- Skills & mastery: admin-defined categories, coach-managed skills,
-- per-session coach assessments with 1-5 ratings, mastery derived 0-100.

create table public.skill_categories (
  id uuid default gen_random_uuid() not null primary key,
  name text not null,
  sort_order smallint default 0 not null,
  created_at timestamptz default now() not null
);

create table public.skills (
  id uuid default gen_random_uuid() not null primary key,
  category_id uuid not null references public.skill_categories(id) on delete cascade,
  name text not null,
  -- Coaches "remove" by deactivating so rating history survives; only the
  -- founder hard-deletes. Mastery counts active skills only.
  active boolean default true not null,
  sort_order smallint default 0 not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now() not null
);
create index skills_category_idx on public.skills (category_id);

-- One assessment event = one coach rating one player once (optionally tied to
-- the session that prompted it). Ratings hang off it so history is kept.
create table public.skill_assessments (
  id uuid default gen_random_uuid() not null primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.class_sessions(id) on delete set null,
  created_at timestamptz default now() not null
);
-- One assessment per coach per player per session ("pending" completion marker).
create unique index skill_assessments_once_per_session
  on public.skill_assessments (player_id, session_id, coach_id)
  where session_id is not null;
create index skill_assessments_player_created_idx
  on public.skill_assessments (player_id, created_at desc);
create index skill_assessments_coach_idx on public.skill_assessments (coach_id);
create index skill_assessments_session_idx on public.skill_assessments (session_id);

create table public.skill_ratings (
  id uuid default gen_random_uuid() not null primary key,
  assessment_id uuid not null references public.skill_assessments(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  unique (assessment_id, skill_id)
);
create index skill_ratings_skill_idx on public.skill_ratings (skill_id);

-- ---------- RLS ----------
alter table public.skill_categories enable row level security;
alter table public.skills enable row level security;
alter table public.skill_assessments enable row level security;
alter table public.skill_ratings enable row level security;

-- Categories: founder manages, coaches read. Clients get nothing (mastery via RPC).
create policy "staff reads categories" on public.skill_categories
  for select using ((select is_coach()) or (select is_founder()));
create policy "founder manages categories" on public.skill_categories
  for all using ((select is_founder())) with check ((select is_founder()));

-- Skills: coaches add + deactivate; founder full control; hard delete founder-only.
create policy "staff reads skills" on public.skills
  for select using ((select is_coach()) or (select is_founder()));
create policy "staff adds skills" on public.skills
  for insert with check ((select is_coach()) or (select is_founder()));
create policy "staff updates skills" on public.skills
  for update using ((select is_coach()) or (select is_founder()));
create policy "founder deletes skills" on public.skills
  for delete using ((select is_founder()));

-- Assessments/ratings: staff-only. No client policies at all — clients only
-- ever see the derived mastery number via get_players_mastery().
create policy "staff reads assessments" on public.skill_assessments
  for select using ((select is_coach()) or (select is_founder()));
create policy "author writes assessments" on public.skill_assessments
  for insert with check (
    coach_id = (select auth.uid())
    and ((select is_coach()) or (select is_founder()))
  );
create policy "founder deletes assessments" on public.skill_assessments
  for delete using ((select is_founder()));

create policy "staff reads ratings" on public.skill_ratings
  for select using ((select is_coach()) or (select is_founder()));
create policy "author writes ratings" on public.skill_ratings
  for insert with check (
    exists (
      select 1 from skill_assessments a
      where a.id = assessment_id and a.coach_id = (select auth.uid())
    )
  );
create policy "founder deletes ratings" on public.skill_ratings
  for delete using ((select is_founder()));

-- ---------- Views & functions ----------

-- Latest rating per (player, skill) across all coaches. security_invoker so
-- the staff-only RLS of the underlying tables applies to direct reads.
create view public.latest_skill_ratings
  with (security_invoker = true) as
  select distinct on (a.player_id, r.skill_id)
         a.player_id, r.skill_id, r.rating, a.coach_id, a.created_at
    from skill_ratings r
    join skill_assessments a on a.id = r.assessment_id
   order by a.player_id, r.skill_id, a.created_at desc;

-- Mastery 0-100 for a set of players. SECURITY DEFINER: silently filters to
-- players the caller may see (founder: all; coach: own roster; client: own
-- household) — never exposes per-skill ratings.
create or replace function public.get_players_mastery(p_players uuid[])
returns table(player_id uuid, mastery integer)
language sql stable security definer
set search_path to 'public'
as $$
  with authorized as (
    select pl.id from players pl
    where pl.id = any(p_players)
      and (
        is_founder()
        or (is_coach() and coach_has_player(pl.id))
        or pl.client_id = auth.uid()
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
$$;

-- Sessions this coach has taught (ended, last 7 days) with attended players
-- still lacking that coach's assessment. Founder may query any coach (preview).
create or replace function public.get_pending_assessments(p_coach uuid default auth.uid())
returns table(player_id uuid, player_name text, session_id uuid,
              class_title text, session_ended_at timestamptz)
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if p_coach <> auth.uid() and not is_founder() then
    raise exception 'not_authorised';
  end if;
  return query
    select b.player_id, pl.full_name, s.id, c.title, s.ends_at
      from bookings b
      join class_sessions s on s.id = b.session_id
      join classes c on c.id = s.class_id
      join players pl on pl.id = b.player_id
     where s.coach_id = p_coach
       and b.status = 'attended'
       and s.ends_at < now()
       and s.ends_at > now() - interval '7 days'
       and not exists (
         select 1 from skill_assessments a
          where a.player_id = b.player_id
            and a.session_id = s.id
            and a.coach_id = p_coach
       )
     order by s.ends_at asc, pl.full_name;
end;
$$;
