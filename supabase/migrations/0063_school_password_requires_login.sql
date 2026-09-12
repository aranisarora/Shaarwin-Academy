-- Saving a school's password must fail loudly when there is no login to save it
-- against.
--
-- As shipped in 0062, `set_school_password` did its work through
-- `update school_admins set password_secret_id = ... where user_id = p_user`
-- and never asked whether that UPDATE touched anything. With no matching
-- `school_admins` row it touched nothing, returned void, and the caller — which
-- reads "no error" as "stored" — told the founder the password was saved. The
-- next time he opened that school the vault read came back null and the screen
-- said we had no password saved for it. Two screens, two contradictory
-- statements, and the only control on offer between them is the reset that
-- locks out everyone at the campus.
--
-- The write also banked a vault secret named after a user nobody could reach
-- through `school_admins`, so the plaintext of a live credential sat encrypted
-- in the vault with no row left pointing at it and nothing that would ever
-- clear it.
--
-- It is reachable: `resetSchoolPasswordCore` checks that the profile is a
-- school account and never that the link row survived. So the row is asserted
-- here, once, before either branch runs — before `vault.create_secret` on the
-- first save, and before `vault.update_secret` on every later one — and again
-- after the UPDATE, which is what catches the row being deleted underneath us
-- between the two statements.
--
-- Everything else about the function is 0062's, unchanged; see that migration
-- for why the plaintext is kept at all and why the gate lives in the body.

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

  -- No link row, no login: refuse before touching the vault, so a password we
  -- cannot store is never reported as stored and never leaves a secret behind.
  if not found then
    raise exception 'no_school_login';
  end if;

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
    if not found then
      raise exception 'no_school_login';
    end if;
  else
    perform vault.update_secret(v_secret, p_password);
  end if;
end;
$function$;

-- Unchanged from 0062, restated because `create or replace function` resets
-- nothing about privileges but a reader of this file should not have to go
-- looking: nothing here is reachable with an anon key.
revoke all on function public.set_school_password(uuid, text) from public, anon;
grant execute on function public.set_school_password(uuid, text) to authenticated, service_role;
