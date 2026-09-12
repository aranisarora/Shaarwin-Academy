-- Coach invites (allowlist) — pre-register a coach's details so that when they
-- sign up with a matching email (or message the bot from a matching phone) their
-- account is initialised as a coach instead of a client. No per-person token:
-- the admin just hands out the normal website signup link.

create table public.coach_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  phone text,
  bio text,
  tier smallint not null default 1,
  max_teachable_level skill_level not null default 'advanced',
  travel_radius_km numeric(5,1) not null default 10,
  dbs_checked boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references profiles(id) on delete set null
);

create index coach_invites_phone_idx on public.coach_invites (phone) where phone is not null;

alter table public.coach_invites enable row level security;

create policy "founder all coach invites" on public.coach_invites
  as permissive for all to public using (is_founder());

-- Signup hook — the single choke point every account passes through. When the
-- new user's email matches an unclaimed invite, provision them as a coach.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_invite public.coach_invites%rowtype;
begin
  select * into v_invite
  from public.coach_invites
  where lower(email) = lower(new.email)
    and claimed_at is null
  order by created_at
  limit 1;

  if found then
    insert into profiles (id, role, full_name, email, phone)
    values (
      new.id,
      'coach',
      coalesce(nullif(v_invite.full_name, ''), v_name),
      new.email,
      v_invite.phone
    )
    on conflict (id) do nothing;

    insert into coaches (
      id, bio, base_lat, base_lng, travel_radius_km,
      max_teachable_level, dbs_checked, tier, active
    )
    values (
      new.id, v_invite.bio, 12.9716, 77.5946, v_invite.travel_radius_km,
      v_invite.max_teachable_level, v_invite.dbs_checked, v_invite.tier, true
    )
    on conflict (id) do nothing;

    update public.coach_invites
    set claimed_at = now(), claimed_by = new.id
    where id = v_invite.id;

    return new;
  end if;

  insert into profiles (id, role, full_name, email)
  values (new.id, 'client', v_name, new.email)
  on conflict (id) do nothing;

  insert into players (client_id, full_name)
  select new.id, v_name
  where not exists (select 1 from players where client_id = new.id);

  return new;
end;
$function$;

-- WhatsApp phone-first path: autoProvisionClient creates a user with a synthetic
-- email (so the email match above can't fire). After it sets profiles.phone, it
-- calls this to upgrade the fresh account to a coach if the phone was invited.
create or replace function public.claim_coach_invite_by_phone(p_user uuid, p_phone text)
  returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_invite public.coach_invites%rowtype;
begin
  select * into v_invite
  from public.coach_invites
  where phone = p_phone
    and claimed_at is null
  order by created_at
  limit 1;
  if not found then
    return false;
  end if;

  update profiles set role = 'coach' where id = p_user;

  insert into coaches (
    id, bio, base_lat, base_lng, travel_radius_km,
    max_teachable_level, dbs_checked, tier, active
  )
  values (
    p_user, v_invite.bio, 12.9716, 77.5946, v_invite.travel_radius_km,
    v_invite.max_teachable_level, v_invite.dbs_checked, v_invite.tier, true
  )
  on conflict (id) do nothing;

  update public.coach_invites
  set claimed_at = now(), claimed_by = p_user
  where id = v_invite.id;

  return true;
end;
$function$;
