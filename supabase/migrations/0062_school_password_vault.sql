-- A school's password stops being something you see once.
--
-- One credential goes to a school and several people there use it — the sports
-- head, the coordinator, whoever is on the desk that term. Until now the
-- plaintext existed for exactly one screen, because Supabase keeps a bcrypt
-- hash and nothing else, so "what was TISB's password again?" had a single
-- answer: reset it, and break it for everyone who already had it. The owner
-- asked for the opposite. Open a school, read the password back, as often as he
-- likes, without changing anything for the people already using it.
--
-- That means keeping the plaintext, and the only honest way to keep it is
-- encrypted, somewhere `public` cannot reach. Supabase Vault (supabase_vault
-- 0.3.1, installed on this project already) holds it. `school_admins` carries
-- only the secret's uuid, so anything that leaks the public schema — a backup,
-- a mis-scoped policy, an over-eager select — yields a pointer and nothing
-- else. PostgREST exposes `public` and `graphql_public` only, so no API key of
-- any kind can read `vault.*` directly; the one route back to plaintext is
-- `public.school_password()` below, which refuses anyone who isn't the founder.
--
-- The tradeoff was put to the owner in those terms and taken deliberately: a
-- shared password he can re-read is worth more to him than one nobody,
-- including him, can ever read again.
--
-- On privileges. The revokes at the bottom are defence in depth, not the
-- enforcement — the test harness rebuilds the local database from schema.sql
-- and then re-grants everything in `public` to anon/authenticated/service_role,
-- so a gate that lived only in an ACL would be real in production and absent in
-- the tests that are supposed to prove it. Every gate below is therefore inside
-- the function body, where both environments run it.

alter table public.school_admins
  add column if not exists password_secret_id uuid;

comment on column public.school_admins.password_secret_id is
  'Vault secret holding this login''s shared password in plaintext. A pointer, not the password — read it only through public.school_password().';

-- ── Writing it ──────────────────────────────────────────────────────────────
-- Called straight after `auth.admin.updateUserById({ password })`, from the
-- same service-role client that did the update, so the two halves of "the
-- password is now X" travel together. The founder's own client is allowed too:
-- both are paths we control and both have already proved who they are.
--
-- `current_setting('role')` is the role PostgREST switched into before the call
-- (`anon`, `authenticated`, `service_role`) and survives the SECURITY DEFINER
-- hop, which rewrites current_user but not that GUC. It is a firmer test than
-- reading the JWT, because it holds for the newer non-JWT secret keys too, and
-- an `authenticated` session cannot SET ROLE its way into `service_role`.

create or replace function public.set_school_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret uuid;
  v_name   text := 'school_login_password:' || p_user::text;
begin
  if not ((select is_founder()) or current_setting('role', true) = 'service_role') then
    raise exception 'not_authorised';
  end if;

  select password_secret_id into v_secret
    from school_admins
   where user_id = p_user
   limit 1;

  if v_secret is null then
    -- `vault.secrets.name` is unique. A login whose row lost its pointer but
    -- whose secret survived would collide here forever, so clear the old one
    -- rather than hand the founder a screen that can never be repaired.
    delete from vault.secrets where name = v_name;
    v_secret := vault.create_secret(
      p_password,
      v_name,
      'Shared sign-in password for a school login (public.school_admins).'
    );
    update school_admins set password_secret_id = v_secret where user_id = p_user;
  else
    perform vault.update_secret(v_secret, p_password);
  end if;
end;
$function$;

-- ── Reading it ──────────────────────────────────────────────────────────────
-- Founder only, and deliberately not service_role: `service_role` is the key
-- our own server code carries, and it already has no path into `vault.*`, so
-- refusing it here keeps the plaintext behind a person rather than behind a
-- deployment secret. The Schools screen runs as the signed-in founder, so
-- nothing legitimate loses out.
--
-- Null means "we have no password saved for this login" — an account made
-- before this migration, or one whose vault write failed. The screen says so
-- and offers a reset; it must never present null as a password.

create or replace function public.school_password(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_password text;
begin
  if not (select is_founder()) then
    raise exception 'not_authorised';
  end if;

  select s.decrypted_secret into v_password
    from school_admins sa
    join vault.decrypted_secrets s on s.id = sa.password_secret_id
   where sa.user_id = p_user
   limit 1;

  return v_password;
end;
$function$;

-- ── Forgetting it ───────────────────────────────────────────────────────────
-- Removing a login deletes the auth user, which cascades to profiles and then
-- to school_admins — taking the pointer with it and stranding the secret. So
-- the caller clears this first, while the row that names it still exists.

create or replace function public.clear_school_password(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret uuid;
begin
  if not ((select is_founder()) or current_setting('role', true) = 'service_role') then
    raise exception 'not_authorised';
  end if;

  select password_secret_id into v_secret
    from school_admins
   where user_id = p_user
   limit 1;

  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
    update school_admins set password_secret_id = null where user_id = p_user;
  end if;

  -- Belt and braces for a row that lost its pointer: the name is derived, so
  -- an orphan is still findable.
  delete from vault.secrets where name = 'school_login_password:' || p_user::text;
end;
$function$;

-- ── Did the handover land? ──────────────────────────────────────────────────
-- `auth.users.last_sign_in_at` is the only evidence the founder has that a
-- school ever used what he sent. It lives in the auth schema, which PostgREST
-- does not expose, and the alternative — one admin-API call per school on every
-- render of the Schools tab — turns a single query into nine round trips.
--
-- Returned for every school login at once, and named apart from the columns it
-- reads so neither plpgsql nor a future reader has to think about shadowing.

create or replace function public.school_last_sign_in()
returns table(school_user_id uuid, signed_in_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not ((select is_founder()) or current_setting('role', true) = 'service_role') then
    raise exception 'not_authorised';
  end if;

  return query
    select sa.user_id, u.last_sign_in_at
      from school_admins sa
      join auth.users u on u.id = sa.user_id;
end;
$function$;

-- ── Privileges ──────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new public functions to anon, authenticated and
-- service_role by default. Nothing here should be reachable with an anon key,
-- and the password read should not be reachable with the service key either.

revoke all on function public.set_school_password(uuid, text) from public, anon;
grant execute on function public.set_school_password(uuid, text) to authenticated, service_role;

revoke all on function public.clear_school_password(uuid) from public, anon;
grant execute on function public.clear_school_password(uuid) to authenticated, service_role;

revoke all on function public.school_last_sign_in() from public, anon;
grant execute on function public.school_last_sign_in() to authenticated, service_role;

revoke all on function public.school_password(uuid) from public, anon, service_role;
grant execute on function public.school_password(uuid) to authenticated;
