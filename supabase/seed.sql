-- P02 seeds — idempotent (fixed UUIDs + on conflict). Run with service role.
-- Creates: 1 founder, 3 coaches, 2 clients (one with 2 children), comp
-- subscriptions, settings. Venues + batches live in migration
-- 0009_bengaluru_batches.sql; this seed only assigns coaches to the
-- generated sessions at the end.

-- ── auth users (id fixed; safe to re-run) ────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'founder@sharwin.example',  crypt('SeedPass!2026', gen_salt('bf')), now(), '{"full_name":"Founder"}',        now(), now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'samir@sharwin.example',    crypt('SeedPass!2026', gen_salt('bf')), now(), '{"full_name":"Samir"}',          now(), now()),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nandan@sharwin.example',   crypt('SeedPass!2026', gen_salt('bf')), now(), '{"full_name":"Nandan"}',         now(), now()),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sunil@sharwin.example',    crypt('SeedPass!2026', gen_salt('bf')), now(), '{"full_name":"Sunil"}',          now(), now()),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-a@sharwin.example', crypt('SeedPass!2026', gen_salt('bf')), now(), '{"full_name":"Alex Morgan"}',    now(), now()),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-b@sharwin.example', crypt('SeedPass!2026', gen_salt('bf')), now(), '{"full_name":"Priya Shah"}',     now(), now())
on conflict (id) do nothing;

-- profiles (trigger may have created client rows — upsert role/name)
insert into profiles (id, role, full_name, email) values
  ('00000000-0000-4000-8000-000000000001', 'founder', 'Founder', 'founder@sharwin.example'),
  ('00000000-0000-4000-8000-000000000011', 'coach', 'Samir',  'samir@sharwin.example'),
  ('00000000-0000-4000-8000-000000000012', 'coach', 'Nandan', 'nandan@sharwin.example'),
  ('00000000-0000-4000-8000-000000000013', 'coach', 'Sunil',  'sunil@sharwin.example'),
  ('00000000-0000-4000-8000-000000000021', 'client', 'Alex Morgan', 'client-a@sharwin.example'),
  ('00000000-0000-4000-8000-000000000022', 'client', 'Priya Shah', 'client-b@sharwin.example')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into coaches (id, bio, base_lat, base_lng, max_teachable_level, dbs_checked) values
  ('00000000-0000-4000-8000-000000000011', 'Former state number one. Calm, technical, relentless about footwork.', 12.9352, 77.6902, 'elite', true),
  ('00000000-0000-4000-8000-000000000012', 'Attack-first coach. Loves teaching the third-ball game.', 12.9110, 77.6670, 'advanced', true),
  ('00000000-0000-4000-8000-000000000013', 'Junior development specialist — patient and precise.', 12.9290, 77.6014, 'advanced', false)
on conflict (id) do nothing;

-- players: clients themselves + two children for Priya
insert into players (id, client_id, full_name, date_of_birth, skill_level) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000021', 'Alex Morgan', '1992-04-12', 'intermediate'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000022', 'Priya Shah', '1985-09-03', 'beginner'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-000000000022', 'Aarav Shah', '2014-02-20', 'beginner'),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-000000000022', 'Mira Shah', '2016-06-15', 'beginner')
on conflict (id) do nothing;

-- venues + group batches come from 0009_bengaluru_batches.sql (fixed UUIDs
-- 00000000-0000-4000-8000-0000000001c* / ...01f*), including 4 weeks of
-- generated sessions.

-- plans (P04 table, monthly billing). price_pence holds paise (minor unit of
-- INR): ₹2,399 = 239,900. group_sessions_per_week > 0 = group plan with a
-- weekly cap; 0 = private plan (no group access).
insert into plans (id, name, description, price_pence, currency, billing_interval_months, group_sessions_per_week, private_minutes_per_cycle, private_sessions_per_week, private_session_minutes) values
  ('00000000-0000-4000-8000-0000000000d4', 'Group — 1×/week', 'One group class a week.', 129900, 'inr', 1, 1, 0, null, null),
  ('00000000-0000-4000-8000-0000000000d5', 'Group — 2×/week', 'Two group classes a week. Our most popular plan.', 239900, 'inr', 1, 2, 0, null, null),
  ('00000000-0000-4000-8000-0000000000d6', 'Group — 3×/week', 'Three group classes a week.', 349900, 'inr', 1, 3, 0, null, null),
  ('00000000-0000-4000-8000-0000000000d7', 'Private — Weekly, 60 min', 'A weekly 60-minute home session (260 minutes a month).', 499900, 'inr', 1, 0, 260, 1, 60),
  ('00000000-0000-4000-8000-0000000000d9', 'Private — 2×/week, 60 min', 'Two 60-minute home sessions a week (520 minutes a month).', 909900, 'inr', 1, 0, 520, 2, 60),
  ('00000000-0000-4000-8000-0000000000db', 'Private — 3×/week, 60 min', 'Three 60-minute home sessions a week (780 minutes a month).', 1200000, 'inr', 1, 0, 780, 3, 60),
  ('00000000-0000-4000-8000-0000000000dc', 'Private — 4×/week, 60 min', 'Four 60-minute home sessions a week (1040 minutes a month).', 1600000, 'inr', 1, 0, 1040, 4, 60)
on conflict (id) do nothing;

-- one-off products (0017): drop-in group class, à-la-carte private hours,
-- and the once-per-child intro promo. member_price_pence applies when the
-- buyer holds an active group plan.
insert into products (id, name, description, kind, price_pence, member_price_pence, grants_minutes, duration_minutes) values
  ('group-dropin', 'Group class — drop-in', 'One group class, no membership needed.', 'group_dropin', 34900, 34900, 0, null),
  ('private-60', 'Private session — 60 min', 'A one-hour session at your home or clubhouse. Coach comes to you.', 'private_oneoff', 119900, 109900, 60, 60),
  ('private-90', 'Private session — 90 min', 'A 90-minute session at your home or clubhouse. Coach comes to you.', 'private_oneoff', 169900, 159900, 90, 90),
  ('private-intro-60', 'Intro offer — first private session (60 min)', 'Promotional price for your first private session. One per child.', 'private_intro', 59900, 59900, 60, 60)
on conflict (id) do nothing;

-- comp subscriptions so booking works before online payments. Alex holds both
-- a group and a private plan (the model allows the pair); Priya group-only.
insert into subscriptions (id, client_id, plan_id, source, status, current_period_start, current_period_end) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-0000000000d7', 'comp', 'active', now(), now() + interval '30 days'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-0000000000d5', 'comp', 'active', now(), now() + interval '30 days'),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-0000000000d5', 'comp', 'active', now(), now() + interval '30 days')
on conflict (id) do nothing;

insert into private_credit_ledger (id, client_id, subscription_id, delta_minutes, reason)
values ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-000000000021',
        '00000000-0000-4000-8000-0000000000e1', 260, 'grant')
on conflict (id) do nothing;

-- sessions were generated coachless at migration time (no coaches existed
-- yet on a fresh database) — top up 4 weeks and let the engine assign the
-- coaches seeded above.
select public.generate_class_sessions(4);

-- settings
insert into settings (key, value) values
  ('assignment_weights', '{"continuity":35,"proximity":25,"load":20,"adjacency":15}'),
  ('cancellation_window_hours', '24'),
  ('booking_cutoff_minutes', '60'),
  ('travel_buffer_minutes', '30'),
  ('reschedule_max_hops', '2'),
  ('dunning_grace_days', '7'),
  ('waitlist_claim_minutes', '15')
on conflict (key) do nothing;
