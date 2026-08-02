-- A school gets a login. Step one of two: the role itself.
--
-- Schools already exist in the data — a `venues` row, `classes.is_school`, and
-- pupils carrying `players.school_venue_id` with no `client_id` at all. What
-- has never existed is a *person* who can sign in as the school and see them.
--
-- That person is not a client. Every client-facing gate (approval, household
-- onboarding, booking, billing, the whole `/app` shell) assumes a household
-- with players in it, and a school satisfies none of them. Giving the school a
-- `client` role and a link table would mean teaching each of those gates to
-- make an exception; a fourth role means `lib/access-gates.ts` ignores it for
-- free, because `gateRedirect` only acts when `role = 'client'`.
--
-- This migration adds ONLY the enum value, and 0058 is what uses it. Postgres
-- refuses to let a new enum value be used in the transaction that added it, and
-- every migration runs in one — so a single combined migration fails with
-- "unsafe use of new value of enum type".

alter type public.user_role add value if not exists 'school';
