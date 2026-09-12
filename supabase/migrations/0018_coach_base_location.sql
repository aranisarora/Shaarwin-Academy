-- Add base location fields to coach_invites (columns on coaches already exist)
alter table public.coach_invites
  add column if not exists base_address text,
  add column if not exists base_lat float8,
  add column if not exists base_lng float8;

-- Drop max_teachable_level / dbs_checked from the new-coach path in handle_new_user;
-- the columns stay on coaches and coach_invites for now (no data loss).
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
      id, bio, base_lat, base_lng, base_address, travel_radius_km, tier, active
    )
    values (
      new.id, v_invite.bio,
      coalesce(v_invite.base_lat, 12.9716),
      coalesce(v_invite.base_lng, 77.5946),
      v_invite.base_address,
      v_invite.travel_radius_km,
      v_invite.tier, true
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
