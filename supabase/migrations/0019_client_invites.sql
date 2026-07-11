-- Client invites — pre-register an existing (offline) client by phone number so
-- their account connects automatically when they sign up. Unlike coach invites
-- (keyed by email), the phone is the identity here: it matches whether they sign
-- up on the web and link WhatsApp, message the bot cold, or an admin sets their
-- phone later. No token — the invite claims itself the moment any client account
-- ends up holding that phone number.

create table public.client_invites (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,               -- E.164, normalizePhone() on write
  full_name text,
  notes text,                               -- carried onto their player record
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references profiles(id) on delete set null
);

alter table public.client_invites enable row level security;

create policy "founder all client invites" on public.client_invites
  as permissive for all to public using (is_founder());

-- Claim hook — every path that attaches a phone to an account funnels through
-- profiles.phone (web profile save, WhatsApp link code, bot auto-provisioning),
-- so a trigger there catches them all. Fills in the pre-entered name only when
-- the account doesn't have a real one yet (bot signups start blank).
create or replace function public.claim_client_invite()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_invite public.client_invites%rowtype;
begin
  if new.role <> 'client' then
    return new;
  end if;

  select * into v_invite
  from public.client_invites
  where phone = new.phone
    and claimed_at is null
  order by created_at
  limit 1;
  if not found then
    return new;
  end if;

  if coalesce(v_invite.full_name, '') <> '' then
    -- Only fill placeholders; never overwrite a name the client chose.
    update profiles
    set full_name = v_invite.full_name
    where id = new.id and coalesce(full_name, '') = '';

    update players
    set full_name = v_invite.full_name
    where client_id = new.id and full_name in ('', 'there');
  end if;

  if coalesce(v_invite.notes, '') <> '' then
    update players
    set notes = v_invite.notes
    where client_id = new.id
      and notes is null
      and id = (
        select id from players
        where client_id = new.id
        order by created_at
        limit 1
      );
  end if;

  update public.client_invites
  set claimed_at = now(), claimed_by = new.id
  where id = v_invite.id;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (new.id, 'client.invite_claim', 'client_invites', v_invite.id,
          jsonb_build_object('phone', new.phone));

  return new;
end;
$function$;

create trigger profiles_claim_client_invite
  after insert or update of phone on public.profiles
  for each row
  when (new.phone is not null)
  execute function public.claim_client_invite();
