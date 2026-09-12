-- Push finally has a sender. This is the door its key is read through.
--
-- Everything about web push has been built except the one secret that makes a
-- push legal: the VAPID private key the worker signs its JWT with. The proper
-- home for that is a Supabase function secret, and it still is — `Deno.env` is
-- read first in the worker, so the day someone runs
-- `supabase secrets set VAPID_PRIVATE_KEY=…` this file quietly stops mattering.
-- But nothing in the environment this was built from can set one: the CLI here
-- is signed in to an account that cannot see this project, and the tooling we
-- do have has no API for function secrets. So the key goes into Supabase Vault,
-- next to the school passwords (0062), for the same reasons: `public` cannot
-- reach `vault.*`, PostgREST exposes `public` and `graphql_public` only, and so
-- the one route back to plaintext is the definer function below, which decides
-- for itself who may call it.
--
-- THE KEY ITSELF IS NOT IN THIS FILE, AND MUST NEVER BE.
--
-- Migrations are committed. A signing key in git is a signing key in every
-- clone, every fork, and every future reader of the history, and no amount of
-- Vault around it helps once the plaintext has been through a commit. Seeding
-- is therefore an out-of-band step, run once per environment against the live
-- database — docs/notifications.md carries the runbook. The shape, so nobody
-- has to reinvent the idempotent upsert, for each of `vapid_private_key`,
-- `vapid_public_key` and `vapid_subject`:
--
--   select id from vault.secrets where name = 'vapid_private_key';
--   -- no row → select vault.create_secret(
--   --             '<value>', 'vapid_private_key',
--   --             'Web push VAPID (RFC 8292). Read only through public.vapid_keys().');
--   -- a row  → select vault.update_secret('<that id>', '<value>');
--
-- Three secrets, not one. The worker needs the private key to sign, the public
-- key to derive the JWK it signs with, and the subject to name us to the push
-- service. Keeping them together means the pair can never half-rotate: a public
-- key that does not match the private one does not warn, it 403s every send.

-- ── Reading them ────────────────────────────────────────────────────────────
-- service_role ONLY, and this is the opposite of `school_password()` (0062) on
-- purpose — the asymmetry is the whole point, so it is worth being explicit
-- about why, because getting it backwards fails in one of two bad ways.
--
-- `school_password()` refuses service_role because a human founder is the only
-- party who should ever see a school's shared credential; the service key is a
-- deployment secret, and keeping that plaintext behind a person rather than
-- behind a deployment secret is the stronger position there.
--
-- Here the only legitimate caller IS a deployment. The notify edge function
-- connects with SUPABASE_SERVICE_ROLE_KEY and nobody else has any business
-- signing a push. So:
--
--   service_role  → allowed. Refuse it and push never sends a single message,
--                   silently, exactly as it has failed until now.
--   authenticated → refused. Every signed-in parent, coach and school head is
--                   `authenticated`. Handing them the signing key would let any
--                   of them push an arbitrary banner to any subscribed device in
--                   the academy, wearing our name.
--   anon          → refused, obviously.
--
-- The founder is not exempted either. He has no use for it and there is no
-- screen that shows it; a route that exists only for a deployment should not
-- also be a route a browser can walk down.
--
-- Nulls rather than an exception when nothing is stored: "we have no key" is a
-- real, honest state (a fresh project, a vault not yet seeded) and the worker
-- answers it by skipping push and letting WhatsApp and email carry everything,
-- exactly as before push existed. An exception here would turn a dormant
-- channel into a broken tick. The aggregate always yields exactly one row, so
-- the caller never has to distinguish "no rows" from "no key".

create or replace function public.vapid_keys()
returns table(public_key text, private_key text, subject text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'not_authorised';
  end if;

  return query
    select
      max(s.decrypted_secret) filter (where s.name = 'vapid_public_key'),
      max(s.decrypted_secret) filter (where s.name = 'vapid_private_key'),
      max(s.decrypted_secret) filter (where s.name = 'vapid_subject')
      from vault.decrypted_secrets s
     where s.name in ('vapid_public_key', 'vapid_private_key', 'vapid_subject');
end;
$function$;

-- Supabase grants EXECUTE on new public functions to anon, authenticated and
-- service_role by default, so the revoke is doing real work. It is still only
-- defence in depth — the gate that counts is inside the body, because the test
-- harness rebuilds the local database from schema.sql and then re-grants all of
-- `public` to every role, so an ACL-only gate would be real in production and
-- absent from the tests meant to prove it.
revoke all on function public.vapid_keys() from public, anon, authenticated;
grant execute on function public.vapid_keys() to service_role;
