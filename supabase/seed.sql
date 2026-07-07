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

insert into coaches (id, bio, base_lat, base_lng, travel_radius_km, max_teachable_level, dbs_checked, tier) values
  ('00000000-0000-4000-8000-000000000011', 'Former state number one. Calm, technical, relentless about footwork.', 12.9352, 77.6902, 12, 'elite', true, 3),
  ('00000000-0000-4000-8000-000000000012', 'Attack-first coach. Loves teaching the third-ball game.', 12.9110, 77.6670, 15, 'advanced', true, 2),
  ('00000000-0000-4000-8000-000000000013', 'Junior development specialist — patient and precise.', 12.9290, 77.6014, 8, 'advanced', false, 1)
on conflict (id) do nothing;

-- weekly availability: Mon–Sat, mornings through evenings (earliest batch 08:00)
insert into coach_availability (coach_id, weekday, start_time, end_time)
select c.id, d.weekday, time '07:30', time '21:30'
from coaches c
cross join (values (0),(1),(2),(3),(4),(5)) as d(weekday)
where c.id in ('00000000-0000-4000-8000-000000000011',
               '00000000-0000-4000-8000-000000000012',
               '00000000-0000-4000-8000-000000000013')
  and not exists (
    select 1 from coach_availability a where a.coach_id = c.id and a.weekday = d.weekday
  );

-- one approved time-off next week for Samir
insert into coach_time_off (id, coach_id, starts_at, ends_at, reason, status)
values ('00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-000000000011',
        date_trunc('week', now()) + interval '7 days',
        date_trunc('week', now()) + interval '8 days',
        'Tournament', 'approved')
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

-- plans (P04 table). price_pence holds paise (minor unit of INR): ₹18,000 = 1,800,000.
insert into plans (id, name, description, price_pence, currency, group_sessions_per_week, private_minutes_per_quarter) values
  ('00000000-0000-4000-8000-0000000000d1', 'Group', 'Up to 2 group sessions a week.', 1800000, 'inr', 2, 0),
  ('00000000-0000-4000-8000-0000000000d2', 'Group+', 'Unlimited group sessions.', 2600000, 'inr', null, 0),
  ('00000000-0000-4000-8000-0000000000d3', 'Private', 'Unlimited group sessions plus 240 private minutes a quarter.', 4200000, 'inr', null, 240)
on conflict (id) do nothing;

-- comp subscriptions so booking works before online payments
insert into subscriptions (id, client_id, plan_id, source, status, current_period_start, current_period_end) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-0000000000d3', 'comp', 'active', now(), now() + interval '90 days'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-0000000000d1', 'comp', 'active', now(), now() + interval '90 days')
on conflict (id) do nothing;

insert into private_credit_ledger (id, client_id, subscription_id, delta_minutes, reason)
values ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-000000000021',
        '00000000-0000-4000-8000-0000000000e1', 240, 'grant')
on conflict (id) do nothing;

-- sessions were generated coachless at migration time (no coaches existed
-- yet on a fresh database) — top up 4 weeks and let the engine assign the
-- coaches seeded above.
select public.generate_class_sessions(4);

-- settings
insert into settings (key, value) values
  ('assignment_weights', '{"continuity":35,"proximity":25,"load":20,"adjacency":15,"seniority":5}'),
  ('cancellation_window_hours', '24'),
  ('booking_cutoff_minutes', '60'),
  ('travel_buffer_minutes', '30'),
  ('reschedule_max_hops', '2'),
  ('dunning_grace_days', '7'),
  ('waitlist_claim_minutes', '15')
on conflict (key) do nothing;
