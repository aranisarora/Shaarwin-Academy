-- Sharwin Academy — canonical public schema.
--
-- MAINTAINED BY HAND to mirror the live database — this is not a pg_dump, and a
-- dump must not be pasted over it (see AGENTS.md -> Database). Edit it in the
-- same commit as the migration, then check it both ways: `npm run db:reset`
-- must rebuild the local DB from it, and the objects you touched must match
-- `supabase db dump --linked --schema public`.
-- Last verified: 2026-08-09 (0072/0073/0074 — not yet applied to prod; local
-- rebuild from this file diffed object-by-object against a live dump, which
-- differs by exactly those three migrations). Earlier: 2026-08-08 (0069 applied
-- to prod; function bodies diffed statement-for-statement against live),
-- 2026-08-06 (0057, 0058, 0059, 0062, 0063).
--
-- This is a reference dump, grouped for readability (extensions, enums, tables,
-- constraints, indexes, functions, view, RLS). It is not guaranteed to run
-- top-to-bottom (e.g. functions are ordered alphabetically, not by dependency).
-- Source of truth for column names, types, enum values, constraints and RLS.

set search_path = public;

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists btree_gist;     -- coach_no_overlap exclusion
create extension if not exists supabase_vault; -- school password plaintext (0062)

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.assignment_status as enum ('active', 'superseded');
create type public.booking_status as enum ('confirmed', 'waitlisted', 'attended', 'no_show', 'rescheduled', 'cancelled_by_client', 'cancelled_by_academy');
create type public.class_credit_source as enum ('signup', 'purchase', 'manual');
create type public.class_credit_type as enum ('group_trial', 'group_dropin');
create type public.class_type as enum ('private', 'group');
create type public.credit_reason as enum ('grant', 'booking', 'cancellation_refund', 'refund_adjustment', 'expiry', 'manual');
create type public.notification_channel as enum ('push', 'email', 'in_app');
create type public.notification_status as enum ('pending', 'sent', 'failed');
create type public.product_kind as enum ('group_dropin', 'private_oneoff', 'private_intro');
create type public.session_status as enum ('scheduled', 'completed', 'cancelled');
create type public.signup_approval_status as enum ('pending', 'approved', 'denied');
create type public.skill_level as enum ('beginner', 'intermediate', 'advanced', 'elite', 'any');
create type public.subscription_source as enum ('stripe', 'comp', 'razorpay');
create type public.subscription_status as enum ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'paused');
create type public.user_role as enum ('client', 'coach', 'founder', 'school');

-- ── Tables ───────────────────────────────────────────────────────────────────
create table public.area_interest (
  id uuid default gen_random_uuid() not null,
  email text not null,
  postcode text not null,
  lat float8,
  lng float8,
  created_at timestamptz default now() not null
);

create table public.audit_log (
  id bigint generated always as identity not null,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  meta jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null
);

create table public.booking_series (
  id uuid default gen_random_uuid() not null,
  client_id uuid,
  player_id uuid not null,
  class_id uuid not null,
  weekday integer not null,
  start_time time not null,
  active boolean default true not null,
  created_at timestamptz default now() not null,
  cancelled_at timestamptz
);

create table public.bookings (
  id uuid default gen_random_uuid() not null,
  session_id uuid not null,
  client_id uuid,
  player_id uuid not null,
  status booking_status default 'confirmed'::booking_status not null,
  waitlist_position integer,
  rescheduled_from uuid,
  coach_note text,
  booked_at timestamptz default now() not null,
  cancelled_at timestamptz,
  cancel_reason text,
  series_id uuid,
  private_series_id uuid
);

create table public.class_credits (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  player_id uuid,
  type class_credit_type not null,
  source class_credit_source default 'manual'::class_credit_source not null,
  order_id uuid,
  booking_id uuid,
  consumed_at timestamptz,
  note text,
  created_at timestamptz default now() not null
);

create table public.class_sessions (
  id uuid default gen_random_uuid() not null,
  class_id uuid not null,
  coach_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status session_status default 'scheduled'::session_status not null,
  capacity_override integer,
  coach_notes text,
  cancel_reason text,
  created_at timestamptz default now() not null,
  coach_arrived_at timestamptz,
  coach_confirmed_at timestamptz,
  coach_arrival_source text,
  coach_arrival_distance_m integer,
  coach_late_at timestamptz
);

create table public.classes (
  id uuid default gen_random_uuid() not null,
  class_type class_type not null,
  is_school boolean default false not null,
  title text not null,
  description text,
  skill_level skill_level default 'beginner'::skill_level not null,
  capacity integer default 1 not null,
  duration_minutes integer not null,
  venue_id uuid,
  timezone text default 'Asia/Kolkata'::text not null,
  recurrence_rule text,
  starts_on date not null,
  ends_on date,
  active boolean default true not null,
  created_by uuid,
  created_at timestamptz default now() not null
);

create table public.client_invites (
  id uuid default gen_random_uuid() not null,
  phone text not null,
  full_name text,
  notes text,
  created_by uuid,
  created_at timestamptz default now() not null,
  claimed_at timestamptz,
  claimed_by uuid,
  plan_id uuid
);

create table public.coach_assignments (
  id uuid default gen_random_uuid() not null,
  session_id uuid not null,
  coach_id uuid not null,
  assigned_by uuid,
  score numeric(5,2),
  locked boolean default false not null,
  status assignment_status default 'active'::assignment_status not null,
  created_at timestamptz default now() not null
);

create table public.coaches (
  id uuid not null,
  bio text,
  base_lat float8 not null,
  base_lng float8 not null,
  base_address text,
  max_teachable_level skill_level default 'advanced'::skill_level not null,
  dbs_checked boolean default false not null,
  active boolean default true not null,
  created_at timestamptz default now() not null,
  photo_url text,
  quote text,
  credentials text[] default '{}'::text[] not null
);

create table public.coach_invites (
  id uuid default gen_random_uuid() not null,
  email text not null,
  full_name text,
  phone text,
  bio text,
  max_teachable_level skill_level default 'advanced'::skill_level not null,
  dbs_checked boolean default false not null,
  base_address text,
  base_lat float8,
  base_lng float8,
  created_by uuid,
  created_at timestamptz default now() not null,
  claimed_at timestamptz,
  claimed_by uuid
);

create table public.invoices (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  subscription_id uuid,
  stripe_invoice_id text,
  amount_pence integer not null,
  currency char(3) default 'inr'::bpchar not null,
  status text not null,
  hosted_invoice_url text,
  paid_at timestamptz,
  created_at timestamptz default now() not null,
  razorpay_payment_id text
);

create table public.notifications (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  channel notification_channel default 'push'::notification_channel not null,
  type text not null,
  title text not null,
  body text not null,
  data jsonb default '{}'::jsonb not null,
  scheduled_for timestamptz default now() not null,
  status notification_status default 'pending'::notification_status not null,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz default now() not null,
  error text,
  channel_attempted text,
  whatsapp_status text
);

comment on column public.notifications.whatsapp_status is
  'Did WhatsApp carry this row? sent | failed | no_phone (no number on the profile, never attempted) | skipped (an earlier channel ended the chain). Independent of status: a row can be status=sent via email while whatsapp_status=failed, and that combination is the one worth alerting on. Null on rows written before 0073 or by a worker older than it.';

comment on column public.notifications.error is
  'Why the preferred channel did not carry this row (worker-written). On a failed row, why nothing was delivered at all; on a sent row, why it fell back to a lesser channel. Null when the intended channel worked.';

create table public.student_notes (
  id uuid default gen_random_uuid() not null,
  player_id uuid not null,
  author_id uuid not null,
  body text not null,
  created_at timestamptz default now() not null
);

create table public.orders (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  player_id uuid,
  product_id text not null,
  razorpay_order_id text,
  razorpay_payment_id text,
  amount_pence integer not null,
  currency char(3) default 'inr'::bpchar not null,
  status text default 'created'::text not null,  -- created | paid
  paid_at timestamptz,
  created_at timestamptz default now() not null
);

create table public.plans (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  stripe_product_id text,
  stripe_price_id text,
  price_pence integer not null,
  currency char(3) default 'inr'::bpchar not null,
  billing_interval_months smallint default 1 not null,
  -- > 0: group plan with weekly cap; 0: private plan (no group access);
  -- null: legacy "unlimited" (comp), treated as group.
  group_sessions_per_week integer,
  private_minutes_per_cycle integer default 0 not null,
  -- null = legacy minutes-only (no weekly cap on privates)
  private_sessions_per_week integer,
  -- null = free 60/90 choice; set = every private session must be this length
  private_session_minutes integer,
  active boolean default true not null,
  created_at timestamptz default now() not null,
  razorpay_plan_id text
);

create table public.players (
  id uuid default gen_random_uuid() not null,
  client_id uuid,
  full_name text not null,
  date_of_birth date,
  skill_level skill_level default 'beginner'::skill_level not null,
  notes text,
  created_at timestamptz default now() not null,
  school_venue_id uuid,
  grade smallint
);

create table public.products (
  id text not null,                              -- stable slug used in code
  name text not null,
  description text,
  kind product_kind not null,
  price_pence integer not null,                  -- paise
  member_price_pence integer,                    -- with an active group plan
  grants_minutes integer default 0 not null,     -- private products credit the ledger
  duration_minutes integer,                      -- display only
  active boolean default true not null,
  created_at timestamptz default now() not null
);

create table public.private_booking_series (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  player_id uuid not null,
  preferred_coach uuid,
  weekday integer not null,          -- ISO 1..7, Asia/Kolkata wall clock
  start_time time not null,          -- IST wall clock
  duration_minutes integer not null,
  address text not null,
  postcode text default '' not null,
  lat float8 not null,
  lng float8 not null,
  has_table boolean default true not null,
  access_notes text,
  address_details jsonb,
  venue_id uuid,
  venue_label text,
  unit_label text,
  active boolean default true not null,
  created_at timestamptz default now() not null,
  cancelled_at timestamptz
);

create table public.private_class_details (
  class_id uuid not null,
  client_id uuid,
  player_id uuid,
  address text not null,
  postcode text not null,
  lat float8 not null,
  lng float8 not null,
  has_table boolean default true not null,
  access_notes text,
  address_details jsonb,
  venue_label text,
  unit_label text
);

create table public.private_credit_ledger (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  subscription_id uuid,
  booking_id uuid,
  delta_minutes integer not null,
  reason credit_reason not null,
  note text,
  created_at timestamptz default now() not null
);

create table public.profiles (
  id uuid not null,
  role user_role default 'client'::user_role not null,
  full_name text not null,
  email text not null,
  phone text,
  avatar_url text,
  default_address text,
  default_lat float8,
  default_lng float8,
  address_details jsonb,
  stripe_customer_id text,
  notification_prefs jsonb default '{}'::jsonb not null,
  disputed boolean default false not null,
  deleted_at timestamptz,
  created_at timestamptz default now() not null,
  razorpay_customer_id text,
  onboarded_at timestamptz,
  -- multi-step onboarding progress: 0 players pending, 1 players saved,
  -- 2 phone confirmed (setup done; onboarded_at stamps completion)
  onboarding_step smallint default 0 not null,
  -- closed-membership gate: self-signups start 'pending' and wait for founder
  -- approval; existing rows + founder-invited clients are 'approved'.
  approval_status signup_approval_status default 'pending'::signup_approval_status not null,
  wa_muted boolean default false not null
);

create table public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now() not null,
  -- The last time a live browser told us this device still exists (0060).
  -- A subscription can stay VALID long after anyone stops opening the browser
  -- that owns it, so this is what separates "the push service accepted it" from
  -- "somebody will see it".
  last_seen_at timestamptz default now() not null
);

-- Who may sign in as a school and read its pupils. Many-to-many so one head can
-- cover two campuses, and a school can hold more than one login.
create table public.school_admins (
  user_id uuid not null,
  venue_id uuid not null,
  created_by uuid,
  created_at timestamptz default now() not null,
  -- Vault secret holding this login's shared password in plaintext (0062). A
  -- pointer, not the password: read it only through public.school_password().
  password_secret_id uuid
);

create table public.settings (
  key text not null,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz default now() not null
);

create table public.subscriptions (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  plan_id uuid not null,
  source subscription_source default 'stripe'::subscription_source not null,
  stripe_subscription_id text,
  status subscription_status default 'incomplete'::subscription_status not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  razorpay_subscription_id text
);

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
  active boolean default true not null,
  sort_order smallint default 0 not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now() not null
);

create table public.skill_assessments (
  id uuid default gen_random_uuid() not null primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.class_sessions(id) on delete set null,
  created_at timestamptz default now() not null
);

create table public.skill_ratings (
  id uuid default gen_random_uuid() not null primary key,
  assessment_id uuid not null references public.skill_assessments(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  unique (assessment_id, skill_id)
);

create table public.venues (
  id uuid default gen_random_uuid() not null,
  name text not null,
  unit text,
  address text not null,
  postcode text not null,
  lat float8 not null,
  lng float8 not null,
  notes text,
  photo_url text,
  address_details jsonb,
  active boolean default true not null,
  -- Said by the founder in the venue editor, never inferred from the classes
  -- that happen to run here (migration 0059). Drives the Schools tab, and keeps
  -- the campus out of every client-facing venue list.
  is_school boolean default false not null,
  created_at timestamptz default now() not null
);

create table public.wa_messages (
  id uuid default gen_random_uuid() not null,
  phone text not null,
  role text not null,
  content text not null,
  created_at timestamptz default now() not null,
  seq bigint generated by default as identity not null
);

create table public.wa_inbound_seen (
  message_sid text not null,
  phone text,
  created_at timestamptz default now() not null
);

create table public.webhook_events (
  id uuid default gen_random_uuid() not null,
  stripe_event_id text,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz default now() not null,
  event_id text
);

-- ── Constraints (PK / FK / UNIQUE / CHECK / EXCLUDE) ─────────────────────────
ALTER TABLE public.area_interest ADD CONSTRAINT area_interest_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.booking_series ADD CONSTRAINT booking_series_pkey PRIMARY KEY (id);
ALTER TABLE public.booking_series ADD CONSTRAINT booking_series_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.booking_series ADD CONSTRAINT booking_series_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.booking_series ADD CONSTRAINT booking_series_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.booking_series ADD CONSTRAINT booking_series_weekday_check CHECK (((weekday >= 1) AND (weekday <= 7)));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_rescheduled_from_fkey FOREIGN KEY (rescheduled_from) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_series_id_fkey FOREIGN KEY (series_id) REFERENCES booking_series(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_private_series_id_fkey FOREIGN KEY (private_series_id) REFERENCES private_booking_series(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.class_credits ADD CONSTRAINT class_credits_pkey PRIMARY KEY (id);
ALTER TABLE public.class_credits ADD CONSTRAINT class_credits_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.class_credits ADD CONSTRAINT class_credits_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.class_credits ADD CONSTRAINT class_credits_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE public.class_credits ADD CONSTRAINT class_credits_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE public.class_sessions ADD CONSTRAINT coach_no_overlap EXCLUDE USING gist (coach_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (((status = 'scheduled'::session_status) AND (coach_id IS NOT NULL)));
ALTER TABLE public.class_sessions ADD CONSTRAINT class_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.class_sessions ADD CONSTRAINT class_sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.class_sessions ADD CONSTRAINT class_sessions_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE SET NULL;
ALTER TABLE public.class_sessions ADD CONSTRAINT class_sessions_capacity_override_check CHECK ((capacity_override >= 1));
ALTER TABLE public.class_sessions ADD CONSTRAINT class_sessions_coach_arrival_source_check CHECK ((coach_arrival_source = ANY (ARRAY['auto'::text, 'tap'::text, 'wa'::text])));
ALTER TABLE public.class_sessions ADD CONSTRAINT session_window CHECK ((starts_at < ends_at));
ALTER TABLE public.classes ADD CONSTRAINT classes_pkey PRIMARY KEY (id);
ALTER TABLE public.classes ADD CONSTRAINT classes_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.classes ADD CONSTRAINT classes_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id);
ALTER TABLE public.classes ADD CONSTRAINT classes_capacity_check CHECK ((capacity >= 1));
ALTER TABLE public.classes ADD CONSTRAINT classes_duration_minutes_check CHECK (((duration_minutes >= 30) AND (duration_minutes <= 360)));
ALTER TABLE public.classes ADD CONSTRAINT group_needs_venue CHECK (((class_type <> 'group'::class_type) OR (venue_id IS NOT NULL)));
ALTER TABLE public.client_invites ADD CONSTRAINT client_invites_pkey PRIMARY KEY (id);
ALTER TABLE public.client_invites ADD CONSTRAINT client_invites_phone_key UNIQUE (phone);
ALTER TABLE public.client_invites ADD CONSTRAINT client_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.client_invites ADD CONSTRAINT client_invites_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.client_invites ADD CONSTRAINT client_invites_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE public.coach_assignments ADD CONSTRAINT coach_assignments_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_assignments ADD CONSTRAINT coach_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.coach_assignments ADD CONSTRAINT coach_assignments_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE;
ALTER TABLE public.coach_assignments ADD CONSTRAINT coach_assignments_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.coaches ADD CONSTRAINT coaches_pkey PRIMARY KEY (id);
ALTER TABLE public.coaches ADD CONSTRAINT coaches_id_fkey FOREIGN KEY (id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_email_key UNIQUE (email);
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_stripe_invoice_id_key UNIQUE (stripe_invoice_id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_whatsapp_status_check CHECK ((whatsapp_status = ANY (ARRAY['sent'::text, 'failed'::text, 'no_phone'::text, 'skipped'::text])));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.student_notes ADD CONSTRAINT student_notes_pkey PRIMARY KEY (id);
ALTER TABLE public.student_notes ADD CONSTRAINT student_notes_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.student_notes ADD CONSTRAINT student_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE public.orders ADD CONSTRAINT orders_razorpay_order_id_key UNIQUE (razorpay_order_id);
ALTER TABLE public.orders ADD CONSTRAINT orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD CONSTRAINT orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.plans ADD CONSTRAINT plans_razorpay_plan_id_key UNIQUE (razorpay_plan_id);
ALTER TABLE public.plans ADD CONSTRAINT plans_stripe_price_id_key UNIQUE (stripe_price_id);
ALTER TABLE public.plans ADD CONSTRAINT plans_pkey PRIMARY KEY (id);
ALTER TABLE public.plans ADD CONSTRAINT plans_price_pence_check CHECK ((price_pence >= 0));
ALTER TABLE public.players ADD CONSTRAINT players_pkey PRIMARY KEY (id);
ALTER TABLE public.players ADD CONSTRAINT players_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.players ADD CONSTRAINT players_school_venue_id_fkey FOREIGN KEY (school_venue_id) REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE public.products ADD CONSTRAINT products_price_pence_check CHECK ((price_pence >= 0));
ALTER TABLE public.products ADD CONSTRAINT products_member_price_pence_check CHECK ((member_price_pence >= 0));
ALTER TABLE public.private_booking_series ADD CONSTRAINT private_booking_series_pkey PRIMARY KEY (id);
ALTER TABLE public.private_booking_series ADD CONSTRAINT private_booking_series_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.private_booking_series ADD CONSTRAINT private_booking_series_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.private_booking_series ADD CONSTRAINT private_booking_series_preferred_coach_fkey FOREIGN KEY (preferred_coach) REFERENCES coaches(id) ON DELETE SET NULL;
ALTER TABLE public.private_booking_series ADD CONSTRAINT private_booking_series_weekday_check CHECK (((weekday >= 1) AND (weekday <= 7)));
ALTER TABLE public.private_booking_series ADD CONSTRAINT private_booking_series_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE public.private_class_details ADD CONSTRAINT private_class_details_pkey PRIMARY KEY (class_id);
ALTER TABLE public.private_class_details ADD CONSTRAINT private_class_details_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
ALTER TABLE public.private_class_details ADD CONSTRAINT private_class_details_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.private_class_details ADD CONSTRAINT private_class_details_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.private_credit_ledger ADD CONSTRAINT private_credit_ledger_pkey PRIMARY KEY (id);
ALTER TABLE public.private_credit_ledger ADD CONSTRAINT private_credit_ledger_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE public.private_credit_ledger ADD CONSTRAINT private_credit_ledger_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.private_credit_ledger ADD CONSTRAINT private_credit_ledger_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_razorpay_customer_id_key UNIQUE (razorpay_customer_id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_stripe_customer_id_key UNIQUE (stripe_customer_id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.school_admins ADD CONSTRAINT school_admins_pkey PRIMARY KEY (user_id, venue_id);
ALTER TABLE public.school_admins ADD CONSTRAINT school_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.school_admins ADD CONSTRAINT school_admins_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
ALTER TABLE public.school_admins ADD CONSTRAINT school_admins_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (key);
ALTER TABLE public.settings ADD CONSTRAINT settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_razorpay_subscription_id_key UNIQUE (razorpay_subscription_id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans(id);
ALTER TABLE public.venues ADD CONSTRAINT venues_pkey PRIMARY KEY (id);
ALTER TABLE public.wa_messages ADD CONSTRAINT wa_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.wa_messages ADD CONSTRAINT wa_messages_seq_key UNIQUE (seq);
ALTER TABLE public.wa_messages ADD CONSTRAINT wa_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
ALTER TABLE public.wa_inbound_seen ADD CONSTRAINT wa_inbound_seen_pkey PRIMARY KEY (message_sid);
ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_event_id_key UNIQUE (event_id);
ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_stripe_event_id_key UNIQUE (stripe_event_id);
ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);

-- ── Indexes (non-constraint) ─────────────────────────────────────────────────
CREATE INDEX audit_log_entity_entity_id_idx ON public.audit_log USING btree (entity, entity_id);
CREATE INDEX booking_series_active_class ON public.booking_series USING btree (class_id) WHERE active;
CREATE UNIQUE INDEX booking_series_one_active ON public.booking_series USING btree (player_id, class_id, weekday, start_time) WHERE active;
CREATE INDEX bookings_client_id_status_idx ON public.bookings USING btree (client_id, status);
CREATE UNIQUE INDEX bookings_one_live_per_player ON public.bookings USING btree (session_id, player_id) WHERE (status = ANY (ARRAY['confirmed'::booking_status, 'waitlisted'::booking_status, 'attended'::booking_status, 'no_show'::booking_status]));
CREATE INDEX bookings_private_series_id ON public.bookings USING btree (private_series_id) WHERE (private_series_id IS NOT NULL);
CREATE INDEX bookings_series_id ON public.bookings USING btree (series_id) WHERE (series_id IS NOT NULL);
CREATE INDEX bookings_session_id_idx ON public.bookings USING btree (session_id) WHERE (status = 'waitlisted'::booking_status);
CREATE INDEX class_credits_client_open_idx ON public.class_credits USING btree (client_id) WHERE (consumed_at IS NULL);
CREATE UNIQUE INDEX class_credits_one_trial_per_client ON public.class_credits USING btree (client_id) WHERE ((type = 'group_trial'::class_credit_type) AND (player_id IS NULL));
CREATE UNIQUE INDEX class_credits_one_trial_per_player ON public.class_credits USING btree (player_id) WHERE (type = 'group_trial'::class_credit_type);
CREATE INDEX class_sessions_class_id_starts_at_idx ON public.class_sessions USING btree (class_id, starts_at);
CREATE INDEX class_sessions_coach_id_starts_at_idx ON public.class_sessions USING btree (coach_id, starts_at) WHERE (status = 'scheduled'::session_status);
CREATE INDEX class_sessions_starts_at_idx ON public.class_sessions USING btree (starts_at) WHERE (coach_id IS NULL);
CREATE INDEX classes_class_type_active_idx ON public.classes USING btree (class_type, active);
CREATE INDEX classes_venue_id_idx ON public.classes USING btree (venue_id) WHERE (venue_id IS NOT NULL);
CREATE INDEX coach_assignments_session_id_status_idx ON public.coach_assignments USING btree (session_id, status);
CREATE INDEX coach_invites_phone_idx ON public.coach_invites USING btree (phone) WHERE (phone IS NOT NULL);
CREATE UNIQUE INDEX invoices_razorpay_payment_id_key ON public.invoices USING btree (razorpay_payment_id) WHERE (razorpay_payment_id IS NOT NULL);
CREATE INDEX notifications_status_scheduled_for_idx ON public.notifications USING btree (status, scheduled_for);
CREATE INDEX student_notes_player_created_idx ON public.student_notes USING btree (player_id, created_at DESC);
CREATE INDEX players_client_id_idx ON public.players USING btree (client_id);
CREATE INDEX private_booking_series_client_active ON public.private_booking_series USING btree (client_id) WHERE active;
CREATE UNIQUE INDEX private_booking_series_one_active ON public.private_booking_series USING btree (player_id, weekday, start_time) WHERE active;
CREATE INDEX private_credit_ledger_client_id_idx ON public.private_credit_ledger USING btree (client_id);
CREATE INDEX subscriptions_client_id_status_idx ON public.subscriptions USING btree (client_id, status);
CREATE UNIQUE INDEX profiles_phone_key ON public.profiles USING btree (phone) WHERE (phone IS NOT NULL);
CREATE INDEX wa_messages_phone_idx ON public.wa_messages USING btree (phone, created_at DESC);
CREATE INDEX wa_messages_phone_seq_idx ON public.wa_messages USING btree (phone, seq DESC);
CREATE INDEX wa_inbound_seen_created_at_idx ON public.wa_inbound_seen USING btree (created_at);
CREATE INDEX bookings_player_id_idx ON public.bookings USING btree (player_id);
CREATE INDEX notifications_user_id_idx ON public.notifications USING btree (user_id);
CREATE INDEX notifications_failed_idx ON public.notifications USING btree (created_at DESC) WHERE (status = 'failed'::notification_status);
CREATE INDEX notifications_user_type_created_idx ON public.notifications USING btree (user_id, type, created_at DESC);
CREATE INDEX notifications_whatsapp_missed_idx ON public.notifications USING btree (whatsapp_status, created_at DESC) WHERE (whatsapp_status = ANY (ARRAY['failed'::text, 'no_phone'::text]));
CREATE INDEX class_credits_booking_id_idx ON public.class_credits USING btree (booking_id);
CREATE INDEX class_credits_order_id_idx ON public.class_credits USING btree (order_id);
CREATE INDEX orders_client_id_idx ON public.orders USING btree (client_id);
CREATE INDEX orders_player_id_idx ON public.orders USING btree (player_id);
CREATE INDEX orders_product_id_idx ON public.orders USING btree (product_id);
CREATE INDEX private_credit_ledger_booking_id_idx ON public.private_credit_ledger USING btree (booking_id);
CREATE INDEX private_credit_ledger_subscription_id_idx ON public.private_credit_ledger USING btree (subscription_id);
CREATE INDEX invoices_client_id_idx ON public.invoices USING btree (client_id);
CREATE INDEX invoices_subscription_id_idx ON public.invoices USING btree (subscription_id);
CREATE INDEX subscriptions_plan_id_idx ON public.subscriptions USING btree (plan_id);
CREATE INDEX private_class_details_client_id_idx ON public.private_class_details USING btree (client_id);
CREATE INDEX private_class_details_player_id_idx ON public.private_class_details USING btree (player_id);
CREATE INDEX coach_assignments_coach_id_idx ON public.coach_assignments USING btree (coach_id);
CREATE INDEX student_notes_author_id_idx ON public.student_notes USING btree (author_id);
CREATE INDEX skills_category_idx ON public.skills USING btree (category_id);
CREATE UNIQUE INDEX skill_assessments_once_per_session ON public.skill_assessments USING btree (player_id, session_id, coach_id) WHERE (session_id IS NOT NULL);
CREATE INDEX skill_assessments_player_created_idx ON public.skill_assessments USING btree (player_id, created_at DESC);
CREATE INDEX skill_assessments_coach_idx ON public.skill_assessments USING btree (coach_id);
CREATE INDEX skill_assessments_session_idx ON public.skill_assessments USING btree (session_id);
CREATE INDEX skill_ratings_skill_idx ON public.skill_ratings USING btree (skill_id);
CREATE INDEX school_admins_venue_idx ON public.school_admins USING btree (venue_id);
CREATE INDEX push_subscriptions_last_seen_at_idx ON public.push_subscriptions USING btree (last_seen_at);

-- ── Functions ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._assert_private_plan_allows(p_client uuid, p_start timestamp with time zone, p_duration integer)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_spw int; v_mins int; v_used int;
begin
  select sessions_per_week, session_minutes into v_spw, v_mins
  from private_plan_limits(p_client);

  if v_mins is not null and p_duration <> v_mins then
    raise exception 'plan_duration_mismatch';
  end if;

  if v_spw is not null then
    select count(*) into v_used
    from bookings b
    join class_sessions cs on cs.id = b.session_id
    join classes c on c.id = cs.class_id
    where b.client_id = p_client and b.status = 'confirmed'
      and c.class_type = 'private'
      and date_trunc('week', cs.starts_at at time zone 'Asia/Kolkata')
        = date_trunc('week', p_start at time zone 'Asia/Kolkata');
    if v_used >= v_spw then
      raise exception 'private_weekly_cap';
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public._book_one(p_session uuid, p_client uuid, p_player uuid, p_series uuid DEFAULT NULL::uuid, p_notify boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_tz text;
  v_cutoff int := get_setting_int('booking_cutoff_minutes', 60);
  v_cap int; v_used int; v_capacity int; v_confirmed int; v_position int;
  v_booking bookings%rowtype;
begin
  select * into v_session from class_sessions where id = p_session for update;
  if not found then return 'skip_cutoff'; end if;
  select * into v_class from classes where id = v_session.class_id;
  v_tz := coalesce(v_class.timezone, 'Asia/Kolkata');

  if v_session.status <> 'scheduled'
     or v_session.starts_at <= now() + make_interval(mins => v_cutoff) then
    return 'skip_cutoff';
  end if;

  -- Weekly cap (group only), ISO week in the class timezone.
  select p.group_sessions_per_week into v_cap
  from subscriptions s join plans p on p.id = s.plan_id
  where s.client_id = p_client and s.status in ('active','trialing','past_due')
  order by s.created_at desc limit 1;

  if v_cap is not null and v_class.class_type = 'group' then
    select count(*) into v_used
    from bookings b
    join class_sessions cs on cs.id = b.session_id
    join classes c on c.id = cs.class_id
    where b.client_id = p_client and b.status = 'confirmed'
      and c.class_type = 'group'
      and date_trunc('week', cs.starts_at at time zone v_tz)
        = date_trunc('week', v_session.starts_at at time zone v_tz);
    if v_used >= v_cap then return 'skip_cap'; end if;
  end if;

  -- No overlapping confirmed booking for the same player.
  if exists (
    select 1 from bookings b
    join class_sessions cs on cs.id = b.session_id
    where b.player_id = p_player and b.status = 'confirmed'
      and tstzrange(cs.starts_at, cs.ends_at) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then
    return 'skip_overlap';
  end if;

  v_capacity := coalesce(v_session.capacity_override, v_class.capacity);
  select count(*) into v_confirmed from bookings
  where session_id = p_session and status = 'confirmed';

  begin
    if v_confirmed < v_capacity then
      insert into bookings (session_id, client_id, player_id, status, series_id)
      values (p_session, p_client, p_player, 'confirmed', p_series)
      returning * into v_booking;

      if p_notify then
        insert into notifications (user_id, type, title, body, data, scheduled_for) values
          (p_client, 'booking_confirmed', 'Booked.',
           to_char(v_session.starts_at at time zone v_tz, 'Dy DD Mon, FMHH12:MI am') || ' — ' || v_class.title,
           jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
           now());
      end if;
      -- one consolidated reminder ~3h before start (P11 delivers)
      insert into notifications (user_id, type, title, body, data, scheduled_for) values
        (p_client, 'reminder_upcoming', 'Later today', v_class.title,
         jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session,
           'class_title', v_class.title,
           'time_str', to_char(v_session.starts_at at time zone v_tz, 'FMHH12:MI am'),
           'url', '/app/schedule'),
         v_session.starts_at - interval '3 hours');
      return 'confirmed';
    else
      select coalesce(max(waitlist_position), 0) + 1 into v_position
      from bookings where session_id = p_session and status = 'waitlisted';
      insert into bookings (session_id, client_id, player_id, status, waitlist_position, series_id)
      values (p_session, p_client, p_player, 'waitlisted', v_position, p_series);
      return 'waitlisted';
    end if;
  exception when unique_violation then
    return 'skip_dupe';  -- already has a live booking on this session
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public._consume_group_credit(p_client uuid, p_player uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  -- Consume one open class credit for a group booking: the free trial first
  -- (account-level or legacy per-player), then any drop-in. Raises
  -- no_entitlement when nothing is available.
  select id into v_id
  from class_credits
  where client_id = p_client and consumed_at is null
    and (
      (type = 'group_trial' and (player_id = p_player or player_id is null))
      or (type = 'group_dropin' and (player_id is null or player_id = p_player))
    )
  order by case when type = 'group_trial' then 0 else 1 end, created_at
  limit 1
  for update skip locked;

  if v_id is null then
    raise exception 'no_entitlement';
  end if;

  update class_credits set consumed_at = now() where id = v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public._create_private_occurrence(p_client uuid, p_player uuid, p_start timestamp with time zone, p_duration integer, p_address text, p_postcode text, p_lat double precision, p_lng double precision, p_has_table boolean, p_access_notes text, p_address_details jsonb, p_preferred uuid DEFAULT NULL::uuid, p_series uuid DEFAULT NULL::uuid, p_notify boolean DEFAULT true, p_venue_id uuid DEFAULT NULL::uuid, p_venue_label text DEFAULT NULL::text, p_unit_label text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_class_id uuid;
  v_session_id uuid;
  v_booking bookings%rowtype;
  v_coach uuid;
  v_where text;
begin
  -- Minutes are the entitlement: they arrive from a private plan's monthly
  -- grant or a one-off purchase. No subscription requirement.
  if private_minutes_balance(p_client) < p_duration then
    raise exception 'insufficient_minutes';
  end if;

  perform _assert_private_plan_allows(p_client, p_start, p_duration);

  insert into classes (class_type, title, skill_level, capacity, duration_minutes, starts_on, created_by, venue_id)
  values ('private', 'Private session', 'beginner', 1, p_duration, (p_start at time zone 'Asia/Kolkata')::date, p_client, p_venue_id)
  returning id into v_class_id;

  insert into private_class_details (class_id, client_id, player_id, address, postcode, lat, lng, has_table, access_notes, address_details, venue_label, unit_label)
  values (v_class_id, p_client, p_player, p_address, coalesce(p_postcode, ''), p_lat, p_lng,
          coalesce(p_has_table, true), p_access_notes, p_address_details,
          case when p_venue_id is null then nullif(btrim(coalesce(p_venue_label, '')), '') end,
          nullif(btrim(coalesce(p_unit_label, '')), ''));

  insert into class_sessions (class_id, starts_at, ends_at)
  values (v_class_id, p_start, p_start + make_interval(mins => p_duration))
  returning id into v_session_id;

  v_coach := assign_coach(v_session_id, p_preferred);

  -- Debit stands even if parked (refund only if founder cancels).
  insert into private_credit_ledger (client_id, delta_minutes, reason)
  values (p_client, -p_duration, 'booking');

  insert into bookings (session_id, client_id, player_id, status, private_series_id)
  values (v_session_id, p_client, p_player, 'confirmed', p_series)
  returning * into v_booking;

  -- One consolidated reminder ~3h before start (P11 delivers). _book_one adds
  -- this for group bookings; private occurrences insert into bookings directly
  -- and would otherwise skip it. Unconditional (not gated on p_notify) so
  -- series-materialized weeks still get reminders.
  insert into notifications (user_id, type, title, body, data, scheduled_for) values
    (p_client, 'reminder_upcoming', 'Later today', 'Private session',
     jsonb_build_object('booking_id', v_booking.id, 'session_id', v_session_id,
       'class_title', 'Private session',
       'time_str', to_char(p_start at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
       'url', '/app/schedule'),
     p_start - interval '3 hours');

  if v_coach is not null then
    if p_notify then
      insert into notifications (user_id, type, title, body, data)
      values (p_client, 'coach_assigned', 'You''re on.',
        'Coach confirmed for ' || to_char(p_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am') || '.',
        jsonb_build_object('session_id', v_session_id, 'coach_id', v_coach, 'url', '/app/schedule'));
    end if;

    -- Venue plus the unit inside it, from the stored columns above — the same
    -- string location_label() hands the read-time paths, so the booking message
    -- and the reminder three hours before it name the same place. Falls back to
    -- the raw address so an unlabelled location still tells the coach where to
    -- go. A notification body is frozen at INSERT, which is why this composes
    -- here rather than relying on a read-time fix.
    v_where := coalesce(class_location_label(v_class_id), p_address);

    insert into notifications (user_id, type, title, body, data)
    values (v_coach, 'new_private_session', 'New private session',
      to_char(p_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am') || ' — ' || v_where,
      jsonb_build_object('session_id', v_session_id,
        'location_str', v_where,
        'maps_url', class_location_maps_url(v_class_id),
        'time_str', to_char(p_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am'),
        'url', '/coach/session/' || v_session_id));
  else
    insert into notifications (user_id, type, title, body, data)
    select p.id, 'private_request_parked', 'Private request parked',
           'A private request has no available coach — resolve manually.',
           jsonb_build_object('session_id', v_session_id, 'url', '/admin/calendar')
    from profiles p where p.role = 'founder';

    if p_notify then
      insert into notifications (user_id, type, title, body, data)
      values (p_client, 'coach_assigned', 'We''re confirming your coach',
              'You''ll hear from us within 24 hours.',
              jsonb_build_object('session_id', v_session_id, 'url', '/app/schedule'));
    end if;
  end if;

  return v_session_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_coach(p_session uuid, p_preferred uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_winner uuid;
  v_score numeric;
begin
  -- Never touch a locked assignment (E3)
  if exists (
    select 1 from coach_assignments
    where session_id = p_session and status = 'active' and locked
  ) then
    select coach_id into v_winner from coach_assignments
    where session_id = p_session and status = 'active' and locked;
    return v_winner;
  end if;

  select coach_id, score into v_winner, v_score
  from rank_coaches(p_session, p_preferred) limit 1;

  if v_winner is null then
    update class_sessions set coach_id = null where id = p_session;
    perform alert_founders_session(
      'session_unassigned', 'Session needs a coach',
      'No coach fits this slot — resolve it in the calendar.',
      '/admin/calendar', p_session);
    return null;
  end if;

  update coach_assignments set status = 'superseded'
  where session_id = p_session and status = 'active';

  insert into coach_assignments (session_id, coach_id, assigned_by, score, status)
  values (p_session, v_winner, null, v_score, 'active');

  update class_sessions set coach_id = v_winner where id = p_session;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (null, 'session.assign', 'class_sessions', p_session,
          jsonb_build_object('coach_id', v_winner, 'score', v_score));

  return v_winner;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_unassigned_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select id from class_sessions
    where coach_id is null and status = 'scheduled' and starts_at > now()
  loop
    if assign_coach(r.id) is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.book_series(p_session uuid, p_player uuid, p_recurring boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_tz text;
  v_weekday int; v_time time;
  v_series uuid := null;
  v_status text;
  v_first text := null;
  v_confirmed int := 0; v_waitlisted int := 0; v_skipped int := 0;
  v_booking bookings%rowtype;
  r record;
begin
  if v_client is null then raise exception 'not_authenticated'; end if;

  select * into v_session from class_sessions where id = p_session;
  if not found then raise exception 'session_not_found'; end if;
  select * into v_class from classes where id = v_session.class_id;
  v_tz := coalesce(v_class.timezone, 'Asia/Kolkata');

  if not exists (select 1 from players where id = p_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  -- No group subscription: a single session can ride on a trial/drop-in credit
  -- (book_session consumes it); a recurring series needs a membership.
  if not has_group_subscription(v_client) then
    if p_recurring then
      raise exception 'recurring_needs_membership';
    end if;
    v_booking := book_session(p_session, p_player);
    return jsonb_build_object(
      'series_id', null,
      'confirmed', case when v_booking.status = 'confirmed' then 1 else 0 end,
      'waitlisted', case when v_booking.status = 'waitlisted' then 1 else 0 end,
      'skipped', 0,
      'first_status', v_booking.status::text);
  end if;

  v_weekday := extract(isodow from (v_session.starts_at at time zone v_tz))::int;
  v_time := (v_session.starts_at at time zone v_tz)::time;

  if p_recurring then
    -- reuse an existing active series for this slot, else create one
    select id into v_series from booking_series
    where player_id = p_player and class_id = v_session.class_id
      and weekday = v_weekday and start_time = v_time and active;
    if v_series is null then
      insert into booking_series (client_id, player_id, class_id, weekday, start_time)
      values (v_client, p_player, v_session.class_id, v_weekday, v_time)
      returning id into v_series;
    end if;

    -- enrol every future occurrence of this slot, nearest first (notify only the first)
    for r in
      select s.id, s.starts_at from class_sessions s
      where s.class_id = v_session.class_id and s.status = 'scheduled'
        and s.starts_at > now()
        and extract(isodow from (s.starts_at at time zone v_tz))::int = v_weekday
        and (s.starts_at at time zone v_tz)::time = v_time
      order by s.starts_at
    loop
      v_status := _book_one(r.id, v_client, p_player, v_series, v_first is null);
      if v_first is null then v_first := v_status; end if;
      if v_status = 'confirmed' then v_confirmed := v_confirmed + 1;
      elsif v_status = 'waitlisted' then v_waitlisted := v_waitlisted + 1;
      else v_skipped := v_skipped + 1; end if;
    end loop;
  else
    v_status := _book_one(p_session, v_client, p_player, null, true);
    v_first := v_status;
    if v_status = 'confirmed' then v_confirmed := 1;
    elsif v_status = 'waitlisted' then v_waitlisted := 1;
    else v_skipped := 1; end if;
  end if;

  return jsonb_build_object(
    'series_id', v_series, 'confirmed', v_confirmed,
    'waitlisted', v_waitlisted, 'skipped', v_skipped, 'first_status', v_first);
end;
$function$;

CREATE OR REPLACE FUNCTION public.book_session(p_session uuid, p_player uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_capacity int;
  v_confirmed int;
  v_cap int;
  v_used int;
  v_booking bookings%rowtype;
  v_position int;
  v_credit uuid := null;
  v_cutoff int := get_setting_int('booking_cutoff_minutes', 60);
begin
  if v_client is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_session from class_sessions where id = p_session for update;
  if not found then raise exception 'session_not_found'; end if;

  select * into v_class from classes where id = v_session.class_id;

  if v_session.status <> 'scheduled'
     or v_session.starts_at <= now() + make_interval(mins => v_cutoff) then
    raise exception 'session_not_bookable';
  end if;

  if not exists (select 1 from players where id = p_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  -- Entitlement: a group subscription, else consume a trial/drop-in credit.
  if not has_group_subscription(v_client) then
    v_credit := _consume_group_credit(v_client, p_player);  -- raises no_entitlement
  end if;

  -- Weekly cap (ISO week of the session, in class timezone) — subscription only
  select p.group_sessions_per_week into v_cap
  from subscriptions s join plans p on p.id = s.plan_id
  where s.client_id = v_client
    and s.status in ('active', 'trialing', 'past_due')
    and (p.group_sessions_per_week is null or p.group_sessions_per_week > 0)
  order by s.created_at desc limit 1;

  if v_credit is null and v_cap is not null then
    select count(*) into v_used
    from bookings b
    join class_sessions cs on cs.id = b.session_id
    join classes c on c.id = cs.class_id
    where b.client_id = v_client
      and b.status = 'confirmed'
      and c.class_type = 'group'
      and date_trunc('week', cs.starts_at at time zone 'Asia/Kolkata')
        = date_trunc('week', v_session.starts_at at time zone 'Asia/Kolkata');
    if v_used >= v_cap then
      raise exception 'weekly_cap_reached';
    end if;
  end if;

  -- No overlapping confirmed booking for the same player (A2)
  if exists (
    select 1 from bookings b
    join class_sessions cs on cs.id = b.session_id
    where b.player_id = p_player
      and b.status = 'confirmed'
      and tstzrange(cs.starts_at, cs.ends_at) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then
    raise exception 'player_double_booked';
  end if;

  v_capacity := coalesce(v_session.capacity_override, v_class.capacity);
  select count(*) into v_confirmed
  from bookings where session_id = p_session and status = 'confirmed';

  if v_confirmed < v_capacity then
    insert into bookings (session_id, client_id, player_id, status)
    values (p_session, v_client, p_player, 'confirmed')
    returning * into v_booking;

    -- confirmation + one consolidated reminder ~3h before start (P11 delivers)
    insert into notifications (user_id, type, title, body, data, scheduled_for) values
      (v_client, 'booking_confirmed', 'Booked.',
       to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI am') || ' — ' || v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
       now()),
      (v_client, 'reminder_upcoming', 'Later today', v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session,
         'class_title', v_class.title,
         'time_str', to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
         'url', '/app/schedule'),
       v_session.starts_at - interval '3 hours');
  else
    select coalesce(max(waitlist_position), 0) + 1 into v_position
    from bookings where session_id = p_session and status = 'waitlisted';

    insert into bookings (session_id, client_id, player_id, status, waitlist_position)
    values (p_session, v_client, p_player, 'waitlisted', v_position)
    returning * into v_booking;

    raise notice 'session_full_waitlisted';
  end if;

  if v_credit is not null then
    update class_credits set booking_id = v_booking.id where id = v_credit;
  end if;

  return v_booking;
exception
  when unique_violation then
    raise exception 'already_booked';
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_booking bookings%rowtype;
  v_session class_sessions%rowtype;
  v_window int := get_setting_int('cancellation_window_hours', 24);
  v_free boolean;
  v_next bookings%rowtype;
  v_is_private boolean;
  v_duration int;
begin
  select * into v_booking from bookings where id = p_booking for update;
  if not found or (v_booking.client_id <> v_client and not is_founder()) then
    raise exception 'booking_not_found';
  end if;
  if v_booking.status not in ('confirmed', 'waitlisted') then
    raise exception 'booking_not_live';
  end if;

  select * into v_session from class_sessions where id = v_booking.session_id for update;
  v_free := v_session.starts_at >= now() + make_interval(hours => v_window);

  update bookings
  set status = 'cancelled_by_client',
      cancelled_at = now(),
      cancel_reason = case when v_free then 'in_window' else 'late' end
  where id = p_booking;

  -- Private sessions: refund minutes when in-window (P07)
  select c.class_type = 'private', c.duration_minutes into v_is_private, v_duration
  from classes c where c.id = v_session.class_id;

  if v_is_private and v_free then
    insert into private_credit_ledger (client_id, booking_id, delta_minutes, reason)
    values (v_booking.client_id, p_booking, v_duration, 'cancellation_refund');
  end if;

  -- Private sessions have exactly one booking: cancel the session itself so it
  -- doesn't linger on the coach calendar, and tell the coach.
  if v_is_private then
    update class_sessions
    set status = 'cancelled', cancel_reason = 'client_cancelled'
    where id = v_session.id and status = 'scheduled';
    if v_session.coach_id is not null then
      insert into notifications (user_id, type, title, body, data)
      values (v_session.coach_id, 'session_cancelled', 'Private session cancelled',
        'The ' || to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am')
        || ' private session was cancelled by the client.',
        jsonb_build_object('session_id', v_session.id, 'url', '/coach/calendar'));
    end if;
  end if;

  -- Group credit (trial / drop-in): hand it back when cancelled in-window.
  if v_free then
    update class_credits
    set consumed_at = null, booking_id = null
    where booking_id = p_booking;
  end if;

  -- Offer-based waitlist promotion (A3): notify position 1, don't auto-confirm.
  if not v_is_private and v_booking.status = 'confirmed' then
    select * into v_next
    from bookings
    where session_id = v_booking.session_id and status = 'waitlisted'
    order by waitlist_position asc limit 1;

    if found then
      insert into notifications (user_id, type, title, body, data, scheduled_for)
      select v_next.client_id, 'waitlist_spot', 'A spot opened',
        'Claim it within ' || get_setting_int('waitlist_claim_minutes', 15) || ' minutes.',
        jsonb_build_object('booking_id', v_next.id, 'session_id', v_booking.session_id,
                           'claim_by', now() + make_interval(mins => get_setting_int('waitlist_claim_minutes', 15)),
                           'class_title', coalesce(c.title, 'a class'),
                           'claim_minutes', get_setting_int('waitlist_claim_minutes', 15),
                           'url', '/app/book/class/' || v_booking.session_id),
        now()
      from class_sessions s join classes c on c.id = s.class_id
      where s.id = v_booking.session_id;
    end if;
  end if;

  -- Sweep pending reminders for this booking (P11 hygiene, done inline here)
  delete from notifications
  where status = 'pending'
    and (data->>'booking_id')::uuid = p_booking
    and type in ('reminder_24h', 'reminder_2h', 'reminder_upcoming');
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_school_player(p_session uuid, p_full_name text, p_grade smallint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_class     classes%rowtype;
  v_start     timestamptz;
  v_player    uuid;
  v_series    uuid;
  v_weekday   int;
  v_time      time;
  v_dob       date;
begin
  select cs.starts_at into v_start from class_sessions cs where cs.id = p_session;
  if not found then raise exception 'session not found'; end if;
  select c.* into v_class
  from class_sessions cs join classes c on c.id = cs.class_id
  where cs.id = p_session;
  if not v_class.is_school then raise exception 'not a school class'; end if;

  if not (is_founder() or exists (
      select 1 from class_sessions cs
      where cs.id = p_session and cs.coach_id = v_uid)) then
    raise exception 'not authorised';
  end if;

  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'name required';
  end if;

  -- Approximate DOB from grade: an Indian Grade N pupil is roughly N + 5 years old.
  if p_grade is not null then
    v_dob := make_date(extract(year from now())::int - (p_grade + 5), 1, 1);
  end if;

  insert into players (client_id, full_name, date_of_birth, grade, school_venue_id, skill_level)
  values (null, btrim(p_full_name), v_dob, p_grade, v_class.venue_id, 'beginner')
  returning id into v_player;

  -- Weekly series so future generated sessions pick them up automatically.
  v_weekday := extract(isodow from (v_start at time zone 'Asia/Kolkata'))::int;
  v_time    := (v_start at time zone 'Asia/Kolkata')::time;
  insert into booking_series (client_id, player_id, class_id, weekday, start_time)
  values (null, v_player, v_class.id, v_weekday, v_time)
  returning id into v_series;

  -- Book this session and every future scheduled session of the class now.
  insert into bookings (session_id, client_id, player_id, status, series_id)
  select cs.id, null, v_player, 'confirmed', v_series
  from class_sessions cs
  where cs.class_id = v_class.id
    and cs.status = 'scheduled'
    and cs.starts_at >= v_start;

  return v_player;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_private_series(p_series uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_series private_booking_series%rowtype;
  r record;
  v_count int := 0;
begin
  select * into v_series from private_booking_series where id = p_series;
  if not found or (v_series.client_id <> v_client and not is_founder()) then
    raise exception 'series_not_found';
  end if;

  for r in
    select b.id from bookings b
    join class_sessions cs on cs.id = b.session_id
    where b.private_series_id = p_series
      and b.status in ('confirmed', 'waitlisted')
      and cs.starts_at > now()
  loop
    perform cancel_booking(r.id);  -- handles in-window refund + session teardown
    v_count := v_count + 1;
  end loop;

  update private_booking_series set active = false, cancelled_at = now()
  where id = p_series;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_series(p_series uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_series booking_series%rowtype;
  v_count int := 0;
  r record;
begin
  select * into v_series from booking_series where id = p_series;
  if not found or (v_series.client_id <> v_client and not is_founder()) then
    raise exception 'series_not_found';
  end if;

  for r in
    select b.id, b.session_id from bookings b
    join class_sessions s on s.id = b.session_id
    where b.series_id = p_series and b.status in ('confirmed','waitlisted')
      and s.starts_at > now()
  loop
    update bookings set status = 'cancelled_by_client', cancelled_at = now(),
      cancel_reason = 'series_cancelled'
    where id = r.id;
    v_count := v_count + 1;

    -- offer the freed seat to the head of the waitlist
    insert into notifications (user_id, type, title, body, data, scheduled_for)
    select b.client_id, 'waitlist_spot', 'A spot opened',
      'Claim it within ' || get_setting_int('waitlist_claim_minutes', 15) || ' minutes.',
      jsonb_build_object('booking_id', b.id, 'session_id', r.session_id,
        'class_title', coalesce(c.title, 'a class'),
        'claim_minutes', get_setting_int('waitlist_claim_minutes', 15),
        'url', '/app/book/class/' || r.session_id), now()
    from bookings b
    join class_sessions s on s.id = b.session_id
    join classes c on c.id = s.class_id
    where b.session_id = r.session_id and b.status = 'waitlisted'
    order by b.waitlist_position asc limit 1;

    delete from notifications where status = 'pending'
      and (data->>'booking_id')::uuid = r.id
      and type in ('reminder_24h','reminder_2h','reminder_upcoming');
  end loop;

  update booking_series set active = false, cancelled_at = now() where id = p_series;
  return v_count;
end;
$function$;


CREATE OR REPLACE FUNCTION public.end_private_series_as_academy(p_series uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_series    private_booking_series%rowtype;
  v_cancelled int := 0;
  v_refunded  int := 0;
  v_minutes   int := 0;
  v_clients   uuid[] := '{}';
  v_coaches   uuid[] := '{}';
begin
  if not is_founder() then
    raise exception 'not_authorised';
  end if;

  select * into v_series from private_booking_series where id = p_series;
  if not found then
    raise exception 'series_not_found';
  end if;

  -- Retire the template FIRST. generate_private_sessions loops `where active`
  -- and pg_cron runs it nightly, so a failure anywhere below this line leaves a
  -- dormant series -- safe, and re-runnable -- rather than a live one that
  -- refills tonight the very weeks we are about to cancel.
  update private_booking_series
     set active = false, cancelled_at = now()
   where id = p_series;

  drop table if exists _pbs_doomed;
  create temp table _pbs_doomed on commit drop as
    select b.id as booking_id, b.client_id,
           cs.id as session_id, cs.coach_id,
           c.duration_minutes
      from bookings b
      join class_sessions cs on cs.id = b.session_id
      join classes c on c.id = cs.class_id
     where b.private_series_id = p_series
       and b.status in ('confirmed', 'waitlisted')
       and cs.starts_at > now();

  -- A full refund for every week, including one inside the cancellation window.
  -- cancel_booking withholds that refund because a family cancelling late has
  -- already cost the coach the evening. The academy ending its own slot has not.
  insert into private_credit_ledger (client_id, booking_id, delta_minutes, reason, note)
  select d.client_id, d.booking_id, d.duration_minutes, 'cancellation_refund',
         'weekly private slot ended by the academy'
    from _pbs_doomed d
   where d.client_id is not null;
  get diagnostics v_refunded = row_count;

  select coalesce(sum(duration_minutes), 0) into v_minutes
    from _pbs_doomed where client_id is not null;

  -- 'cancelled_by_academy' is the one status ops_notify_booking_status ignores.
  -- That is the reason this is a set-based UPDATE and not a loop over
  -- cancel_booking: it is what stops the founder's own phone taking one
  -- ops_cancellation per week per family.
  update bookings b
     set status = 'cancelled_by_academy',
         cancelled_at = now(),
         cancel_reason = 'weekly slot ended'
    from _pbs_doomed d
   where b.id = d.booking_id;
  get diagnostics v_cancelled = row_count;

  update class_sessions cs
     set status = 'cancelled', cancel_reason = 'weekly slot ended'
    from _pbs_doomed d
   where cs.id = d.session_id;

  -- Reminders already queued for hours that will not happen. Only reachable
  -- from in here: notifications has no DELETE policy for the app to use.
  delete from notifications n
   where n.status = 'pending'
     and n.data ? 'session_id'
     and n.data->>'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (n.data->>'session_id')::uuid in (select session_id from _pbs_doomed);

  select coalesce(array_agg(distinct client_id) filter (where client_id is not null), '{}'),
         coalesce(array_agg(distinct coach_id)  filter (where coach_id  is not null), '{}')
    into v_clients, v_coaches
    from _pbs_doomed;

  return jsonb_build_object(
    'cancelled',        v_cancelled,
    'refunded',         v_refunded,
    'minutes_returned', v_minutes,
    'client_ids',       to_jsonb(v_clients),
    'coach_ids',        to_jsonb(v_coaches),
    'weekday',          v_series.weekday,
    'start_time',       v_series.start_time::text
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.end_private_series_as_academy(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.end_private_series_as_academy(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.purge_pending_session_reminders(p_class_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int;
begin
  if not is_founder() then raise exception 'not_authorised'; end if;
  if p_class_ids is null or array_length(p_class_ids, 1) is null then return 0; end if;

  delete from notifications n
   where n.status = 'pending'
     and n.data ? 'session_id'
     and n.data->>'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (n.data->>'session_id')::uuid in (
       select s.id from class_sessions s where s.class_id = any(p_class_ids)
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION public.purge_pending_session_reminders(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.purge_pending_session_reminders(uuid[]) TO authenticated;


CREATE OR REPLACE FUNCTION public.wipe_calendar(p_scope text DEFAULT 'all'::text, p_confirm text DEFAULT NULL::text, p_keep_history boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
 SET lock_timeout TO '30s'
AS $function$
declare
  v_doomed    uuid[];
  v_classes   int := 0;
  v_series    int := 0;
  v_gseries   int := 0;
  v_sessions  int := 0;
  v_bookings  int := 0;
  v_minutes   int := 0;
  v_credits   int := 0;
  v_msgs      int := 0;
  v_coach_msgs int := 0;
  v_reminders int := 0;
begin
  if not is_founder() then
    raise exception 'not_authorised';
  end if;
  -- A typed token, not a boolean. The entire guard is that this string cannot
  -- be produced by a mis-tap on a phone.
  if p_confirm is distinct from 'WIPE' then
    raise exception 'confirm_required';
  end if;
  if p_scope not in ('all', 'group', 'private') then
    raise exception 'bad_scope';
  end if;

  select coalesce(array_agg(id), '{}') into v_doomed
    from classes
   where (p_scope = 'all'
       or (p_scope = 'group'   and class_type = 'group')
       or (p_scope = 'private' and class_type = 'private'));
  v_classes := coalesce(array_length(v_doomed, 1), 0);

  -- (a) Retire the templates BEFORE anything else. private_booking_series has no
  --     FK to classes at all, so deleting every class would leave every live
  --     series standing, and the nightly generator would put the weeks back the
  --     same night -- each with a fresh coach assignment and a fresh minutes
  --     debit. booking_series is reached only by CASCADE, so a group standing
  --     booking would otherwise be destroyed without its holder ever hearing.
  if p_scope in ('all', 'private') then
    update private_booking_series set active = false, cancelled_at = now() where active;
    get diagnostics v_series = row_count;
  end if;
  if p_scope in ('all', 'group') then
    update booking_series set active = false, cancelled_at = now()
     where active and class_id = any(v_doomed);
    get diagnostics v_gseries = row_count;
  end if;

  -- (b) What is actually being taken away from people, captured once so every
  --     step below agrees about who is affected.
  drop table if exists _wipe_doomed;
  create temp table _wipe_doomed on commit drop as
    select b.id as booking_id, b.client_id,
           cs.id as session_id, cs.coach_id,
           c.class_type, c.duration_minutes
      from bookings b
      join class_sessions cs on cs.id = b.session_id
      join classes c on c.id = cs.class_id
     where c.id = any(v_doomed)
       and b.status in ('confirmed', 'waitlisted')
       and cs.starts_at > now();

  -- (c) Give back what was paid for. The private ledger's -duration debit is
  --     written by _create_private_occurrence with booking_id NULL, so it
  --     survives a cascade untouched and cannot be found from the booking side
  --     afterwards -- the compensating row has to be written here, before the
  --     delete, or the family is simply out the minutes.
  insert into private_credit_ledger (client_id, booking_id, delta_minutes, reason, note)
  select d.client_id, d.booking_id, d.duration_minutes, 'cancellation_refund',
         'calendar cleared'
    from _wipe_doomed d
   where d.client_id is not null and d.class_type = 'private';

  select coalesce(sum(duration_minutes), 0) into v_minutes
    from _wipe_doomed where client_id is not null and class_type = 'private';

  -- A group trial/drop-in credit is burned by consumed_at, and
  -- class_credits.booking_id is ON DELETE SET NULL -- so a cascade would leave
  -- it burned with nothing left to point at. Hand it back.
  update class_credits
     set consumed_at = null, booking_id = null
   where booking_id in (select booking_id from _wipe_doomed);
  get diagnostics v_credits = row_count;

  -- (d) Cancel, as the academy.
  update bookings b
     set status = 'cancelled_by_academy',
         cancelled_at = now(),
         cancel_reason = 'calendar cleared'
    from _wipe_doomed d
   where b.id = d.booking_id;
  get diagnostics v_bookings = row_count;

  update class_sessions cs
     set status = 'cancelled', cancel_reason = 'calendar cleared'
   where cs.class_id = any(v_doomed)
     and cs.status = 'scheduled'
     and cs.starts_at > now();
  get diagnostics v_sessions = row_count;

  -- An hour that already came and went with no register marked is settled as
  -- completed, not cancelled -- it genuinely did happen. Same cut the
  -- class-ending path uses: ends_at, so a session halfway through right now is
  -- left alone rather than taken off a coach's screen mid-class.
  update class_sessions
     set status = 'completed'
   where class_id = any(v_doomed) and status = 'scheduled' and ends_at < now();

  -- (e) ONE message per person. An INSERT..SELECT..GROUP BY cannot send twice.
  insert into notifications (user_id, type, title, body, data)
  select d.client_id, 'session_cancelled',
         'Your sessions are cancelled',
         'We have cleared the schedule. Your ' || count(*) ||
         case when count(*) = 1 then ' upcoming session is' else ' upcoming sessions are' end ||
         ' cancelled' ||
         case when sum(case when d.class_type = 'private' then d.duration_minutes else 0 end) > 0
              then ', and ' || sum(case when d.class_type = 'private' then d.duration_minutes else 0 end) ||
                   ' private minutes are back on your account'
              else '' end ||
         '. Nothing for you to do -- we will be in touch when the new timetable is up.',
         jsonb_build_object('url', '/app/schedule',
                            'session_count', count(*),
                            'collapsed', true)
    from _wipe_doomed d
   where d.client_id is not null
   group by d.client_id;
  get diagnostics v_msgs = row_count;

  insert into notifications (user_id, type, title, body, data)
  select d.coach_id, 'session_cancelled',
         'Your upcoming sessions are cancelled',
         'The schedule has been cleared. ' || count(*) ||
         case when count(*) = 1 then ' session is' else ' sessions are' end ||
         ' off your calendar. Nothing for you to do.',
         jsonb_build_object('url', '/coach',
                            'session_count', count(*),
                            'collapsed', true)
    from _wipe_doomed d
   where d.coach_id is not null
   group by d.coach_id;
  get diagnostics v_coach_msgs = row_count;

  -- (f) Reminders for hours that will not exist in a moment.
  delete from notifications n
   where n.status = 'pending'
     and n.data ? 'session_id'
     and n.data->>'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (n.data->>'session_id')::uuid in (
       select s.id from class_sessions s where s.class_id = any(v_doomed)
     );
  get diagnostics v_reminders = row_count;

  -- (g) The delete itself, LAST, so every crash point above leaves a recoverable
  --     calendar rather than a half-deleted one. Venues are deliberately
  --     untouched: a venue is a place, not a calendar entry, and
  --     classes_venue_id_fkey is the one NO ACTION foreign key in this graph.
  if p_keep_history then
    update classes set active = false, ends_on = current_date where id = any(v_doomed);
  else
    delete from classes where id = any(v_doomed);
  end if;

  -- (h) audit_log has no FK to the entity it names and no DELETE policy, so it
  --     outlives everything above. After a wipe it is the ONLY surviving record
  --     of what the calendar contained -- so it carries the ids, not just counts.
  insert into audit_log (actor_id, action, entity, meta)
  values (auth.uid(), 'calendar.wipe', 'classes',
          jsonb_build_object(
            'scope', p_scope, 'keep_history', p_keep_history,
            'classes', v_classes, 'class_ids', to_jsonb(v_doomed),
            'private_series_retired', v_series, 'group_series_retired', v_gseries,
            'sessions_cancelled', v_sessions, 'bookings_cancelled', v_bookings,
            'minutes_returned', v_minutes, 'credits_returned', v_credits,
            'clients_messaged', v_msgs, 'coaches_messaged', v_coach_msgs,
            'reminders_dropped', v_reminders));

  return jsonb_build_object(
    'classes', v_classes, 'private_series', v_series, 'group_series', v_gseries,
    'sessions', v_sessions, 'bookings', v_bookings, 'minutes_returned', v_minutes,
    'credits_returned', v_credits, 'clients_messaged', v_msgs,
    'coaches_messaged', v_coach_msgs, 'reminders_dropped', v_reminders,
    'kept_history', p_keep_history);
end;
$function$;

REVOKE ALL ON FUNCTION public.wipe_calendar(text, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wipe_calendar(text, text, boolean) TO authenticated;


CREATE OR REPLACE FUNCTION public.venue_display(v venues)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select btrim(v.name) || coalesce(' ' || nullif(btrim(v.unit), ''), '');
$function$;

CREATE OR REPLACE FUNCTION public.location_venue(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select venue_display(v) from venues v where v.id = c.venue_id),
    (select nullif(btrim(pcd.venue_label), '')
       from private_class_details pcd where pcd.class_id = c.id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.location_unit(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select nullif(btrim(pcd.unit_label), '')
    from private_class_details pcd where pcd.class_id = c.id;
$function$;

CREATE OR REPLACE FUNCTION public.location_label(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select location_venue(c) || coalesce(', ' || location_unit(c), '');
$function$;

CREATE OR REPLACE FUNCTION public.location_maps_url(c classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select 'https://maps.google.com/?q=' || coalesce(
    (select pcd.lat::text || ',' || pcd.lng::text
       from private_class_details pcd where pcd.class_id = c.id),
    (select v.lat::text || ',' || v.lng::text
       from venues v where v.id = c.venue_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.class_location_maps_url(p_class uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select location_maps_url(c) from classes c where c.id = p_class;
$function$;

CREATE OR REPLACE FUNCTION public.class_location_label(p_class uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select location_label(c) from classes c where c.id = p_class;
$function$;

CREATE OR REPLACE FUNCTION public.class_is_public_group(p_class uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from classes c
    where c.id = p_class and c.active and c.class_type = 'group'
  );
$function$;

CREATE OR REPLACE FUNCTION public.client_owns_private_class(p_class uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from private_class_details d
    where d.class_id = p_class and d.client_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.coach_filter_failure(p_coach uuid, p_session uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_coach coaches%rowtype;
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_buffer int := get_setting_int('travel_buffer_minutes', 30);
begin
  select * into v_coach from coaches where id = p_coach and active;
  if not found then return 'inactive'; end if;

  select * into v_session from class_sessions where id = p_session;
  select * into v_class from classes where id = v_session.class_id;

  -- scheduling overlap (+ travel buffer between different venues)
  if exists (
    select 1 from class_sessions s2
    join classes c2 on c2.id = s2.class_id
    where s2.coach_id = p_coach and s2.status = 'scheduled' and s2.id <> p_session
      and tstzrange(
            s2.starts_at - case when c2.venue_id is distinct from v_class.venue_id
                                then make_interval(mins => v_buffer) else interval '0' end,
            s2.ends_at   + case when c2.venue_id is distinct from v_class.venue_id
                                then make_interval(mins => v_buffer) else interval '0' end
          ) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then return 'overlap'; end if;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.coach_has_client(p_client uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from bookings b
    join class_sessions s on s.id = b.session_id
    where b.client_id = p_client and s.coach_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.coach_has_player(p_player uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from bookings b
    join class_sessions s on s.id = b.session_id
    where b.player_id = p_player and s.coach_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.coach_teaches_class(p_class uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from class_sessions s
    where s.class_id = p_class and s.coach_id = auth.uid()
  );
$function$;

-- The read-side twin of coach_has_player, one step wider: the campus rather
-- than the individual booking. A school class books a pupil onto its sessions
-- only from the session they were added to onwards (add_school_player), so a
-- coach who picks the class up later would otherwise see a roster missing
-- pupils they are about to teach. `client_id is null` keeps it to school
-- pupils — a private client's child at the same school stays out (0076).
CREATE OR REPLACE FUNCTION public.coach_teaches_school_of(p_player uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from players p
    join classes c
      on c.is_school and c.venue_id = p.school_venue_id
    join class_sessions s
      on s.class_id = c.id and s.coach_id = auth.uid()
    where p.id = p_player
      and p.school_venue_id is not null
      and p.client_id is null
  );
$function$;

-- Campuses where the signed-in coach is rostered onto a school class. The
-- roster screen needs the set the policy above implies, and a coach cannot read
-- `classes` and `class_sessions` widely enough to derive it client-side (0076).
CREATE OR REPLACE FUNCTION public.coach_school_venues()
 RETURNS TABLE(venue_id uuid, venue_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct v.id, v.name
  from class_sessions s
  join classes c on c.id = s.class_id and c.is_school
  join venues v on v.id = c.venue_id
  where s.coach_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.create_private_series(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_player uuid := (payload->>'player_id')::uuid;
  v_duration int := (payload->>'duration_minutes')::int;
  v_preferred uuid := nullif(payload->>'preferred_coach', '')::uuid;
  v_weeks int := least(coalesce((payload->>'weeks')::int, 4), 8);
  v_venue uuid := nullif(payload->>'venue_id', '')::uuid;
  v_venue_label text := payload->>'venue_label';
  v_unit_label text := payload->>'unit_label';
  v_spw int; v_mins int;
  v_active_series int;
  v_slots timestamptz[];
  v_first timestamptz;
  v_series uuid;
  v_series_ids uuid[] := '{}';
  v_booked int := 0;
  v_skipped int := 0;
  i int;
begin
  if v_client is null then raise exception 'not_authenticated'; end if;

  if not exists (select 1 from players where id = v_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  -- A standing series needs a private plan with a weekly frequency; legacy
  -- minutes-only clients keep one-off booking (mirrors
  -- recurring_needs_membership on the group side).
  select sessions_per_week, session_minutes into v_spw, v_mins
  from private_plan_limits(v_client);
  if v_spw is null then raise exception 'recurring_needs_private_plan'; end if;
  if v_mins is not null and v_duration <> v_mins then
    raise exception 'plan_duration_mismatch';
  end if;

  select array_agg(value::timestamptz) into v_slots
  from jsonb_array_elements_text(payload->'starts_at_list');
  if v_slots is null or array_length(v_slots, 1) = 0 then
    raise exception 'no_slots';
  end if;

  select count(*) into v_active_series
  from private_booking_series where client_id = v_client and active;
  if v_active_series + array_length(v_slots, 1) > v_spw then
    raise exception 'private_weekly_cap';
  end if;

  foreach v_first in array v_slots loop
    if v_first < now() + interval '24 hours' then
      raise exception 'lead_time_24h';
    end if;

    insert into private_booking_series (
      client_id, player_id, preferred_coach, weekday, start_time, duration_minutes,
      address, postcode, lat, lng, has_table, access_notes, address_details,
      venue_id, venue_label, unit_label)
    values (
      v_client, v_player, v_preferred,
      extract(isodow from (v_first at time zone 'Asia/Kolkata'))::int,
      (v_first at time zone 'Asia/Kolkata')::time,
      v_duration,
      payload->>'address', coalesce(payload->>'postcode', ''),
      (payload->>'lat')::float8, (payload->>'lng')::float8,
      coalesce((payload->>'has_table')::boolean, true),
      payload->>'access_notes', payload->'address_details',
      v_venue,
      case when v_venue is null then nullif(btrim(coalesce(v_venue_label, '')), '') end,
      nullif(btrim(coalesce(v_unit_label, '')), ''))
    returning id into v_series;
    v_series_ids := v_series_ids || v_series;

    -- IST has no DST, so +7 days keeps the wall-clock time stable.
    for i in 0..(v_weeks - 1) loop
      begin
        perform _create_private_occurrence(
          v_client, v_player, v_first + make_interval(days => 7 * i), v_duration,
          payload->>'address', coalesce(payload->>'postcode', ''),
          (payload->>'lat')::float8, (payload->>'lng')::float8,
          coalesce((payload->>'has_table')::boolean, true),
          payload->>'access_notes', payload->'address_details',
          v_preferred, v_series, i = 0,
          v_venue, v_venue_label, v_unit_label);
        v_booked := v_booked + 1;
      exception when others then
        -- The first week must book (that's the promise the client tapped);
        -- later weeks may run out of minutes — the nightly generator picks
        -- them up after the renewal grant.
        if i = 0 then raise; end if;
        v_skipped := v_skipped + 1;
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'series_ids', to_jsonb(v_series_ids),
    'booked', v_booked, 'skipped', v_skipped);
end;
$function$;

CREATE OR REPLACE FUNCTION public.expire_credits()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_balance int;
begin
  for r in
    select s.client_id from subscriptions s
    where s.current_period_end < now() and s.status in ('canceled', 'past_due')
  loop
    v_balance := private_minutes_balance(r.client_id);
    if v_balance > 0 then
      insert into private_credit_ledger (client_id, delta_minutes, reason, note)
      values (r.client_id, -v_balance, 'expiry', 'period end sweep');
    end if;
  end loop;
end;
$function$;

create or replace function public.queue_coach_changed(
  p_user uuid,
  p_session uuid,
  p_title text,
  p_body text,
  p_url text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing notifications%rowtype;
  v_count int;
  v_day_start timestamptz;
  v_first text;
begin
  if p_user is null then return; end if;

  -- Start of the current IST day. India has no DST so this is unambiguous.
  v_day_start := date_trunc('day', now() at time zone 'Asia/Kolkata')
                 at time zone 'Asia/Kolkata';

  select * into v_existing
  from notifications
  where user_id = p_user
    and type = 'coach_changed'
    and status = 'pending'
    and created_at >= v_day_start
  order by created_at
  limit 1
  for update;

  if not found then
    -- notify_name_the_session appends the session to the body on the way in.
    insert into notifications (user_id, type, title, body, data, scheduled_for)
    values (p_user, 'coach_changed', p_title, p_body,
            jsonb_build_object('session_id', p_session, 'url', p_url,
                               'change_count', 1),
            now() + interval '2 minutes');
    return;
  end if;

  -- Second and subsequent changes today → one summary instead of N messages.
  v_count := coalesce((v_existing.data ->> 'change_count')::int, 1) + 1;
  v_first := v_existing.data ->> 'session_label';

  update notifications
  set title = 'Schedule updated',
      body  = case
                when v_first is null then
                  'Your schedule was updated — ' || v_count
                  || ' of your sessions have a new coach.'
                else
                  v_first || ' and ' || (v_count - 1)
                  || case when v_count - 1 = 1 then ' other session'
                          else ' other sessions' end
                  || ' have a new coach.'
              end,
      data  = v_existing.data
              || jsonb_build_object('change_count', v_count,
                                    'url', p_url,
                                    'collapsed', true),
      scheduled_for = greatest(v_existing.scheduled_for, now() + interval '2 minutes')
  where id = v_existing.id;
end;
$function$;

comment on function public.queue_coach_changed is
  'Queue a coach_changed notification, collapsing repeats for the same user on the same IST day into one summary row that names the first session and counts the rest. The per-session wording is added by notify_name_the_session.';

-- ── Session alerts — the same collapse for standing conditions (0069) ────────
--
-- `session_unassigned` sent 105 messages about 18 sessions on 2026-08-08, and
-- 120 about 12 on 2026-08-02. Two multipliers: assign_coach re-announces an
-- unchanged condition every time any scheduling path re-runs it (one session
-- produced 15 rows in twenty minutes), and every unassigned session fans out to
-- every founder. The type is CAP_EXEMPT in the worker, so the daily cap that
-- holds other types down was never going to catch it. See migration 0069.

create or replace function public._session_alert_text(
  p_sessions    jsonb,
  p_base_title  text,
  p_base_body   text,
  p_summary_fmt text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_n     int := coalesce(jsonb_array_length(p_sessions), 0);
  v_label text;
begin
  if v_n = 0 then
    return jsonb_build_object('title', p_base_title, 'body', p_base_body);
  end if;

  v_label := session_label((p_sessions ->> 0)::uuid);

  if v_n = 1 then
    return jsonb_build_object(
      'title', p_base_title,
      'body',  case when v_label is null then p_base_body
                    else rtrim(p_base_body, ' .') || ' — ' || v_label || '.' end);
  end if;

  return jsonb_build_object(
    'title', format(p_summary_fmt, v_n),
    'body',  coalesce(v_label || ' and ', '')
             || (v_n - 1) || ' other session' || case when v_n > 2 then 's' else '' end
             || ' have no coach — open the calendar to assign.');
end;
$function$;

comment on function public._session_alert_text is
  'Title/body for a session alert carrying N sessions. Names the first and counts the rest (0055 house style). Shared by queue_session_alert and resolve_session_alert so a rewrite reads like a fresh queue.';

create or replace function public.queue_session_alert(
  p_user        uuid,
  p_type        text,
  p_title       text,
  p_body        text,
  p_url         text,
  p_session     uuid,
  p_summary_fmt text default '%s sessions need a coach'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing  notifications%rowtype;
  v_day_start timestamptz;
  v_sessions  jsonb;
  v_text      jsonb;
  v_starts    timestamptz;
  v_delay     interval;
begin
  if p_user is null or p_session is null then return; end if;

  v_day_start := date_trunc('day', now() at time zone 'Asia/Kolkata')
                 at time zone 'Asia/Kolkata';

  -- Already told today? Then there is nothing new to say.
  if exists (
    select 1 from notifications
    where user_id = p_user
      and type = p_type
      and created_at >= v_day_start
      and (data -> 'session_ids' @> to_jsonb(p_session::text)
           or data ->> 'session_id' = p_session::text)
  ) then
    return;
  end if;

  select starts_at into v_starts from class_sessions where id = p_session;
  v_delay := case
               when v_starts is not null and v_starts < now() + interval '6 hours'
               then interval '2 minutes'
               else interval '10 minutes'
             end;

  select * into v_existing
  from notifications
  where user_id = p_user
    and type = p_type
    and status = 'pending'
    and created_at >= v_day_start
  order by created_at
  limit 1
  for update;

  if found then
    v_sessions := coalesce(v_existing.data -> 'session_ids', '[]'::jsonb)
                  || to_jsonb(p_session::text);
    v_text := _session_alert_text(
                v_sessions,
                coalesce(v_existing.data ->> 'base_title', p_title),
                coalesce(v_existing.data ->> 'base_body',  p_body),
                coalesce(v_existing.data ->> 'summary_fmt', p_summary_fmt));

    update notifications
    set title = v_text ->> 'title',
        body  = v_text ->> 'body',
        data  = v_existing.data || jsonb_build_object(
                  'session_ids', v_sessions,
                  'alert_count', jsonb_array_length(v_sessions),
                  'collapsed',   jsonb_array_length(v_sessions) > 1),
        -- Urgency may pull the batch forward, never push it back.
        scheduled_for = least(v_existing.scheduled_for, now() + v_delay)
    where id = v_existing.id;
    return;
  end if;

  v_sessions := jsonb_build_array(p_session::text);
  v_text := _session_alert_text(v_sessions, p_title, p_body, p_summary_fmt);

  insert into notifications (user_id, type, title, body, data, scheduled_for)
  values (p_user, p_type, v_text ->> 'title', v_text ->> 'body',
          jsonb_build_object(
            'session_id',  p_session,
            'session_ids', v_sessions,
            'url',         p_url,
            'alert_count', 1,
            'collapsed',   false,
            'base_title',  p_title,
            'base_body',   p_body,
            'summary_fmt', p_summary_fmt),
          now() + v_delay);
end;
$function$;

comment on function public.queue_session_alert is
  'Queue a standing-condition alert about one session for one person. Tells them at most once per IST day per session, and folds a burst into one summary row. See migration 0069.';

create or replace function public.alert_founders_session(
  p_type        text,
  p_title       text,
  p_body        text,
  p_url         text,
  p_session     uuid,
  p_summary_fmt text default '%s sessions need a coach'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f record;
begin
  for f in
    select id from profiles where role = 'founder' and deleted_at is null
  loop
    perform queue_session_alert(f.id, p_type, p_title, p_body, p_url,
                                p_session, p_summary_fmt);
  end loop;
end;
$function$;

comment on function public.alert_founders_session is
  'Queue a session alert for every active founder, collapsed per founder. The single definition of "tell the founders about this session".';

create or replace function public.resolve_session_alert(p_session uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r      record;
  v_left jsonb;
  v_text jsonb;
begin
  if p_session is null then return; end if;

  for r in
    select * from notifications
    where status = 'pending'
      and data -> 'session_ids' @> to_jsonb(p_session::text)
    for update
  loop
    select coalesce(jsonb_agg(s), '[]'::jsonb) into v_left
    from jsonb_array_elements(r.data -> 'session_ids') s
    where s <> to_jsonb(p_session::text);

    if jsonb_array_length(v_left) = 0 then
      -- Nothing left to report and it never went out. Say nothing.
      delete from notifications where id = r.id;
      continue;
    end if;

    v_text := _session_alert_text(
                v_left,
                coalesce(r.data ->> 'base_title', r.title),
                coalesce(r.data ->> 'base_body',  r.body),
                coalesce(r.data ->> 'summary_fmt', '%s sessions need a coach'));

    update notifications
    set title = v_text ->> 'title',
        body  = v_text ->> 'body',
        data  = r.data || jsonb_build_object(
                  'session_id',  (v_left ->> 0)::uuid,
                  'session_ids', v_left,
                  'alert_count', jsonb_array_length(v_left),
                  'collapsed',   jsonb_array_length(v_left) > 1)
    where id = r.id;
  end loop;
end;
$function$;

comment on function public.resolve_session_alert is
  'Drop a session from any session alert that has not been sent yet, deleting the alert if it was the last one. Makes the batching delay in queue_session_alert safe.';

create or replace function public._session_alert_resolve_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    perform resolve_session_alert(old.id);
    return old;
  end if;

  if (new.coach_id is not null and old.coach_id is distinct from new.coach_id)
     or (new.status is distinct from old.status and new.status <> 'scheduled')
  then
    perform resolve_session_alert(new.id);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.founder_reassign(p_session uuid, p_coach uuid, p_lock boolean DEFAULT false, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fail text;
  v_old uuid;
  r record;
begin
  if not is_founder() then raise exception 'founder_only'; end if;

  v_fail := coach_filter_failure(p_coach, p_session);
  if v_fail is not null and not p_force then
    raise exception 'filter_failed_%', v_fail;
  end if;

  select coach_id into v_old from class_sessions where id = p_session;

  update coach_assignments set status = 'superseded'
  where session_id = p_session and status = 'active';

  insert into coach_assignments (session_id, coach_id, assigned_by, locked, status)
  values (p_session, p_coach, auth.uid(), p_lock, 'active');

  update class_sessions set coach_id = p_coach where id = p_session;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'session.reassign', 'class_sessions', p_session,
          jsonb_build_object('from', v_old, 'to', p_coach, 'locked', p_lock,
                             'forced', p_force, 'overridden_rule', v_fail));

  -- notify old coach, new coach, booked clients — each collapsed per day
  if v_old is not null and v_old <> p_coach then
    perform queue_coach_changed(v_old, p_session, 'Session reassigned',
            'One of your sessions was moved to another coach.', '/coach/calendar');
  end if;

  perform queue_coach_changed(p_coach, p_session, 'New session assigned',
          'A session was added to your calendar.', '/coach/calendar');

  for r in
    select distinct b.client_id
    from bookings b
    where b.session_id = p_session and b.status = 'confirmed'
  loop
    perform queue_coach_changed(r.client_id, p_session, 'Meet your new coach',
            'Your session has a new coach — say hello at the table.', '/app/schedule');
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_class_sessions(p_weeks integer DEFAULT 8)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  d date;
  v_days text[];
  v_start timestamptz;
  v_count int := 0;
  v_time time;
  v_tz text;
  v_session_id uuid;
  s record;
begin
  for r in
    select c.*, (select s.starts_at from class_sessions s where s.class_id = c.id
                 order by s.starts_at limit 1) as first_start
    from classes c where c.class_type = 'group' and c.active
      and c.recurrence_rule like 'FREQ=WEEKLY%'
  loop
    v_tz := coalesce(r.timezone, 'Asia/Kolkata');
    v_days := string_to_array(substring(r.recurrence_rule from 'BYDAY=([A-Z,]+)'), ',');
    v_time := coalesce((r.first_start at time zone v_tz)::time, time '18:30');
    for d in select generate_series(current_date, current_date + p_weeks * 7, interval '1 day')::date loop
      exit when r.ends_on is not null and d > r.ends_on;
      if (array['MO','TU','WE','TH','FR','SA','SU'])[extract(isodow from d)::int] = any (v_days) then
        v_start := (d::text || ' ' || v_time::text)::timestamp at time zone v_tz;
        if v_start > now() and not exists (
          select 1 from class_sessions cs where cs.class_id = r.id and cs.starts_at = v_start
        ) then
          insert into class_sessions (class_id, starts_at, ends_at)
          values (r.id, v_start, v_start + make_interval(mins => r.duration_minutes))
          returning id into v_session_id;
          v_count := v_count + 1;

          -- enrol standing series that match this brand-new occurrence
          for s in
            select bs.id as series_id, bs.client_id, bs.player_id
            from booking_series bs
            where bs.active and bs.class_id = r.id
              and bs.weekday = extract(isodow from d)::int
              and bs.start_time = v_time
          loop
            perform _book_one(v_session_id, s.client_id, s.player_id, s.series_id, false);
          end loop;
        end if;
      end if;
    end loop;
  end loop;
  perform assign_unassigned_sessions();
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_private_sessions(p_weeks integer DEFAULT 4)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  d date;
  v_start timestamptz;
  v_count int := 0;
begin
  for r in select * from private_booking_series where active loop
    -- Plan lapsed → retire the series (auto-renew is implicit: it keeps
    -- generating for as long as the subscription stays alive).
    if (select sessions_per_week from private_plan_limits(r.client_id)) is null then
      update private_booking_series set active = false, cancelled_at = now() where id = r.id;
      insert into notifications (user_id, type, title, body, data)
      values (r.client_id, 'private_series_ended', 'Weekly sessions ended',
        'Your weekly private slot ended with your plan. Renew to keep the slot.',
        jsonb_build_object('series_id', r.id, 'url', '/app/billing'));
      continue;
    end if;

    for d in select generate_series(current_date, current_date + p_weeks * 7, interval '1 day')::date loop
      if extract(isodow from d)::int = r.weekday then
        v_start := (d::text || ' ' || r.start_time::text)::timestamp at time zone 'Asia/Kolkata';
        -- A booking of ANY status blocks regeneration: a cancelled week must
        -- not resurrect.
        if v_start > now() + interval '24 hours' and not exists (
          select 1 from bookings b
          join class_sessions cs on cs.id = b.session_id
          where b.private_series_id = r.id and cs.starts_at = v_start
        ) then
          begin
            perform _create_private_occurrence(
              r.client_id, r.player_id, v_start, r.duration_minutes,
              r.address, r.postcode, r.lat, r.lng, r.has_table,
              r.access_notes, r.address_details,
              r.preferred_coach, r.id, false,
              r.venue_id, r.venue_label, r.unit_label);
            v_count := v_count + 1;
          exception when others then
            if sqlerrm = 'insufficient_minutes'
               and v_start < now() + interval '8 days'
               and not exists (
                 select 1 from notifications
                 where user_id = r.client_id and type = 'private_minutes_low'
                   and data->>'series_id' = r.id::text
                   and created_at > now() - interval '3 days'
               ) then
              insert into notifications (user_id, type, title, body, data)
              values (r.client_id, 'private_minutes_low', 'Weekly session paused',
                'Not enough private minutes to book your next weekly session — it resumes when your plan renews.',
                jsonb_build_object('series_id', r.id, 'url', '/app/billing'));
              perform notify_founders('ops_private_series_paused', 'Private series paused',
                'A weekly private slot could not be booked (insufficient minutes).',
                jsonb_build_object('series_id', r.id, 'client_id', r.client_id, 'url', '/admin/billing'));
            end if;
            -- other skips (weekly cap from a one-off booking, etc.) stay silent
          end;
        end if;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_bookable_slots(p_lat double precision, p_lng double precision, p_duration integer, p_player uuid, p_days integer DEFAULT 14)
 RETURNS TABLE(starts_at timestamp with time zone, coach_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with candidate_coaches as (
    select c.* from coaches c
    where c.active
  ),
  slots as (
    select generate_series(
      date_trunc('hour', now() + interval '24 hours'),
      now() + make_interval(days => p_days),
      interval '30 minutes'
    ) as slot_start
  )
  select s.slot_start, count(c.id)::int
  from slots s
  cross join candidate_coaches c
  where
    -- no overlapping scheduled session (+ buffer, conservatively applied)
    not exists (
      select 1 from class_sessions cs
      where cs.coach_id = c.id and cs.status = 'scheduled'
        and tstzrange(cs.starts_at - make_interval(mins => get_setting_int('travel_buffer_minutes', 30)),
                      cs.ends_at + make_interval(mins => get_setting_int('travel_buffer_minutes', 30)))
          && tstzrange(s.slot_start, s.slot_start + make_interval(mins => p_duration))
    )
  group by s.slot_start
  order by s.slot_start;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_setting_int(p_key text, p_default integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select (value)::text::int from settings where key = p_key), p_default);
$function$;

CREATE OR REPLACE FUNCTION public.offer_cover_session(p_session uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_when    text;
  v_where   text;
  v_maps    text;
  v_count   int := 0;
  r record;
begin
  select * into v_session from class_sessions where id = p_session;
  if not found or v_session.status <> 'scheduled' then return 0; end if;
  if v_session.coach_id is not null then return 0; end if;
  if v_session.starts_at <= now() then return 0; end if;

  select * into v_class from classes where id = v_session.class_id;

  v_where := coalesce(class_location_label(v_session.class_id), 'the venue');
  v_maps  := class_location_maps_url(v_session.class_id);

  v_when := fmt_ist(v_session.starts_at);

  for r in select rc.coach_id from rank_coaches(p_session) rc limit 10
  loop
    if exists (
      select 1 from notifications
      where type = 'cover_offer'
        and user_id = r.coach_id
        and data->>'session_id' = p_session::text
    ) then
      continue;
    end if;

    insert into notifications (user_id, type, title, body, data)
    values (r.coach_id, 'cover_offer', 'Cover needed',
      coalesce(v_class.title, 'A session') || ' on ' || v_when || ' at ' || v_where
      || ' needs a coach. First to claim it takes it — tap Claim, or reply "claim".',
      jsonb_strip_nulls(jsonb_build_object('session_id', p_session,
                         'class_title', coalesce(v_class.title, 'a session'),
                         'time_str', v_when,
                         'location_str', v_where,
                         'maps_url', v_maps,
                         'url', '/coach/calendar')));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

create or replace function public.claim_cover_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_coach uuid := auth.uid();
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_name    text;
  v_fail    text;
  r record;
begin
  if v_coach is null then raise exception 'not_authenticated'; end if;
  if not is_coach() then raise exception 'coach_only'; end if;

  -- The lock is the whole mechanism: two coaches tapping at once serialise
  -- here, and the second sees coach_id already set.
  select * into v_session from class_sessions where id = p_session for update;
  if not found or v_session.status <> 'scheduled' then raise exception 'session_not_available'; end if;
  if v_session.starts_at <= now() then raise exception 'session_started'; end if;
  if v_session.coach_id is not null then raise exception 'already_taken'; end if;

  v_fail := coach_filter_failure(v_coach, p_session);
  if v_fail is not null then raise exception 'filter_failed_%', v_fail; end if;

  update coach_assignments set status = 'superseded'
   where session_id = p_session and status = 'active';
  insert into coach_assignments (session_id, coach_id, assigned_by, status)
  values (p_session, v_coach, v_coach, 'active');

  update class_sessions set coach_id = v_coach where id = p_session;

  -- Claiming IS confirming — they've just told us they're coming, so don't turn
  -- round and nag them about it at T-60. This MUST be a second statement: the
  -- BEFORE UPDATE OF coach_id trigger (reset_session_confirmation) clears
  -- coach_confirmed_at whenever the coach changes, so stamping it in the same
  -- statement is silently undone.
  update class_sessions set coach_confirmed_at = now() where id = p_session;

  select * into v_class from classes where id = v_session.class_id;
  select full_name into v_name from profiles where id = v_coach;

  -- Retire the outstanding offers so a later tap gets a clean "already taken"
  -- and the worker stops re-sweeping them.
  update notifications set read_at = now()
   where type = 'cover_offer'
     and data->>'session_id' = p_session::text
     and read_at is null;

  -- The founder hears an outcome, not a task.
  insert into notifications (user_id, type, title, body, data)
  select p.id, 'ops_cover_claimed', 'Cover claimed',
         coalesce(v_name, 'A coach') || ' picked up ' || coalesce(v_class.title, 'a session')
         || ' (' || fmt_ist(v_session.starts_at) || ').',
         jsonb_build_object('session_id', p_session, 'coach_id', v_coach, 'url', '/admin/schedule')
    from profiles p where p.role = 'founder';

  -- Booked families are told, through the same per-day collapse as any other
  -- coach change.
  for r in
    select distinct b.client_id from bookings b
     where b.session_id = p_session and b.status = 'confirmed'
  loop
    perform queue_coach_changed(r.client_id, p_session, 'Meet your new coach',
            'Your session has a coach — say hello at the table.', '/app/schedule');
  end loop;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (v_coach, 'session.cover_claimed', 'class_sessions', p_session,
          jsonb_build_object('coach_id', v_coach));
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_coach_dropout(p_coach uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  c record;
  v_new uuid;
begin
  for r in
    select s.id
    from class_sessions s
    where s.coach_id = p_coach and s.status = 'scheduled'
      and s.starts_at >= p_from and s.starts_at < p_to
      and not exists (
        select 1 from coach_assignments a
        where a.session_id = s.id and a.status = 'active' and a.locked
      )
  loop
    -- exclude the dropping coach by temporarily deactivating is heavy; instead:
    update class_sessions set coach_id = null where id = r.id;
    update coach_assignments set status = 'superseded'
      where session_id = r.id and status = 'active';

    select rc.coach_id into v_new
    from rank_coaches(r.id) rc
    where rc.coach_id <> p_coach
    limit 1;

    if v_new is not null then
      insert into coach_assignments (session_id, coach_id, assigned_by, status)
      values (r.id, v_new, null, 'active');
      update class_sessions set coach_id = v_new where id = r.id;

      perform queue_coach_changed(v_new, r.id, 'You picked up a session',
              'Cover assigned to you automatically.', '/coach/calendar');

      for c in
        select distinct b.client_id
        from bookings b
        where b.session_id = r.id and b.status = 'confirmed'
      loop
        perform queue_coach_changed(c.client_id, r.id, 'Meet your new coach',
                'Your session has a new coach.', '/app/schedule');
      end loop;
    else
      perform alert_founders_session(
        'session_unassigned', 'Cover needed',
        'A coach dropped a session and no substitute fits.',
        '/admin/calendar', r.id, '%s sessions need cover');
      -- clients are NOT notified — founder decides the outcome
      --
      -- ...but before the founder has to ring anyone, offer it out (K8). This
      -- is a no-op when rank_coaches genuinely returns nobody, so the founder
      -- alert above stays the backstop rather than being replaced by it.
      perform offer_cover_session(r.id);
    end if;

    insert into audit_log (actor_id, action, entity, entity_id, meta)
    values (auth.uid(), 'session.dropout_cascade', 'class_sessions', r.id,
            jsonb_build_object('dropped_coach', p_coach, 'replacement', v_new));
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public._delete_class_on_private_details_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from classes where id = old.class_id;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name   text := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_school uuid := nullif(new.raw_user_meta_data->>'school_venue_id', '')::uuid;
  v_invite public.coach_invites%rowtype;
begin
  -- A school login, created by the founder with the admin API. Ordered first:
  -- an explicit school_venue_id is an instruction, a matching coach invite is a
  -- coincidence. No player row — a school is not a household.
  if v_school is not null then
    insert into profiles (id, role, full_name, email, approval_status)
    values (new.id, 'school', v_name, new.email, 'approved')
    on conflict (id) do nothing;

    insert into school_admins (user_id, venue_id)
    values (new.id, v_school)
    on conflict do nothing;

    return new;
  end if;

  select * into v_invite
  from public.coach_invites
  where lower(email) = lower(new.email)
    and claimed_at is null
  order by created_at
  limit 1;

  if found then
    insert into profiles (id, role, full_name, email, phone, approval_status)
    values (
      new.id,
      'coach',
      coalesce(nullif(v_invite.full_name, ''), v_name),
      new.email,
      v_invite.phone,
      'approved'
    )
    on conflict (id) do nothing;

    insert into coaches (
      id, bio, base_lat, base_lng, base_address, active
    )
    values (
      new.id, v_invite.bio,
      coalesce(v_invite.base_lat, 12.9716),
      coalesce(v_invite.base_lng, 77.5946),
      v_invite.base_address,
      true
    )
    on conflict (id) do nothing;

    update public.coach_invites
    set claimed_at = now(), claimed_by = new.id
    where id = v_invite.id;

    return new;
  end if;

  insert into profiles (id, role, full_name, email, approval_status)
  values (new.id, 'client', v_name, new.email, 'pending')
  on conflict (id) do nothing;

  insert into players (client_id, full_name)
  select new.id, v_name
  where not exists (select 1 from players where client_id = new.id);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_waitlist_spot(p_booking uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_booking bookings%rowtype;
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_capacity int;
  v_confirmed int;
begin
  select * into v_booking from bookings where id = p_booking for update;
  if not found or (v_booking.client_id <> v_client and not is_founder()) then
    raise exception 'booking_not_found';
  end if;
  if v_booking.status <> 'waitlisted' then
    raise exception 'not_waitlisted';
  end if;

  select * into v_session from class_sessions where id = v_booking.session_id for update;
  if v_session.status <> 'scheduled'
     or v_session.starts_at <= now() + make_interval(mins => get_setting_int('booking_cutoff_minutes', 60)) then
    raise exception 'session_not_bookable';
  end if;
  select * into v_class from classes where id = v_session.class_id;

  v_capacity := coalesce(v_session.capacity_override, v_class.capacity);
  select count(*) into v_confirmed from bookings
  where session_id = v_booking.session_id and status = 'confirmed';
  if v_confirmed >= v_capacity then
    raise exception 'spot_gone';
  end if;

  update bookings
  set status = 'confirmed', waitlist_position = null
  where id = p_booking;

  -- Confirmation + the single upcoming reminder, mirroring book_session.
  insert into notifications (user_id, type, title, body, data, scheduled_for) values
    (v_booking.client_id, 'booking_confirmed', 'Booked.',
     to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI am') || ' — ' || v_class.title,
     jsonb_build_object('booking_id', v_booking.id, 'session_id', v_booking.session_id, 'url', '/app/schedule'),
     now()),
    (v_booking.client_id, 'reminder_upcoming', 'Later today', v_class.title,
     jsonb_build_object('booking_id', v_booking.id, 'session_id', v_booking.session_id,
       'class_title', v_class.title,
       'time_str', to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
       'url', '/app/schedule'),
     v_session.starts_at - interval '3 hours');

  return 'confirmed';
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_client_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite public.client_invites%rowtype;
  v_sub uuid;
  v_minutes integer;
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

  -- Founder-invited clients never see the approval gate.
  update profiles
  set approval_status = 'approved'
  where id = new.id and approval_status <> 'approved';

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

  -- Gifted plan: grant a comp subscription (30 days, like the admin comp grant)
  -- plus the plan's private minutes, if any.
  if v_invite.plan_id is not null
     and not exists (
       select 1 from subscriptions
       where client_id = new.id
         and status in ('active', 'trialing', 'past_due')
     )
  then
    insert into subscriptions (
      client_id, plan_id, source, status, current_period_start, current_period_end
    )
    values (new.id, v_invite.plan_id, 'comp', 'active', now(), now() + interval '30 days')
    returning id into v_sub;

    select private_minutes_per_cycle into v_minutes
    from plans where id = v_invite.plan_id;
    if coalesce(v_minutes, 0) > 0 then
      insert into private_credit_ledger (
        client_id, subscription_id, delta_minutes, reason, note
      )
      values (new.id, v_sub, v_minutes, 'grant', 'comp grant (pre-registered)');
    end if;
  end if;

  update public.client_invites
  set claimed_at = now(), claimed_by = new.id
  where id = v_invite.id;

  insert into audit_log (actor_id, action, entity, entity_id, meta)
  values (new.id, 'client.invite_claim', 'client_invites', v_invite.id,
          jsonb_build_object('phone', new.phone, 'plan_id', v_invite.plan_id));

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_coach_invite_by_phone(p_user uuid, p_phone text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    id, bio, base_lat, base_lng, base_address, active
  )
  values (
    p_user, v_invite.bio,
    coalesce(v_invite.base_lat, 12.9716),
    coalesce(v_invite.base_lng, 77.5946),
    v_invite.base_address,
    true
  )
  on conflict (id) do nothing;

  update public.coach_invites
  set claimed_at = now(), claimed_by = p_user
  where id = v_invite.id;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_signup_trial()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Free trial: every new client account gets one group-class credit, once,
  -- forever. player_id stays null — the account holder assigns it to a
  -- household player at booking time. Fired by profiles_grant_trial.
  insert into class_credits (client_id, type, source, note)
  values (new.id, 'group_trial', 'signup', 'Free trial class')
  on conflict (client_id) where (type = 'group_trial'::class_credit_type and player_id is null)
  do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.has_active_subscription(p_client uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from subscriptions s
    where s.client_id = p_client
      and (
        s.status in ('active', 'trialing')
        or (
          s.status = 'past_due'
          and s.current_period_end is not null
          and now() <= s.current_period_end
              + make_interval(days => get_setting_int('dunning_grace_days', 7))
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_group_subscription(p_client uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from subscriptions s
    join plans p on p.id = s.plan_id
    where s.client_id = p_client
      and (p.group_sessions_per_week is null or p.group_sessions_per_week > 0)
      and (
        s.status in ('active', 'trialing')
        or (
          s.status = 'past_due'
          and s.current_period_end is not null
          and now() <= s.current_period_end
              + make_interval(days => get_setting_int('dunning_grace_days', 7))
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select 2 * 6371 * asin(sqrt(
    sin(radians((lat2 - lat1) / 2)) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians((lng2 - lng1) / 2)) ^ 2
  ));
$function$;

CREATE OR REPLACE FUNCTION public.is_coach()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'coach'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_founder()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'founder'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_approved()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from profiles
    where id = auth.uid() and approval_status = 'approved'
  );
$function$;

-- ── School access (0058) ─────────────────────────────────────────────────────
-- A school head reads its own campus's pupils and nothing else. "Its own" means
-- school_venue_id in their campuses AND client_id null: a private client's child
-- training on the same campus is never theirs to see.

CREATE OR REPLACE FUNCTION public.is_school_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'school'
  );
$function$;

CREATE OR REPLACE FUNCTION public.school_admin_venues()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select venue_id from school_admins where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.school_has_player(p_player uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from players pl
    where pl.id = p_player
      and pl.client_id is null
      and pl.school_venue_id in (select school_admin_venues())
  );
$function$;

CREATE OR REPLACE FUNCTION public.school_admin_session(p_session uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from bookings b
      join players pl on pl.id = b.player_id
     where b.session_id = p_session
       and pl.client_id is null
       and pl.school_venue_id in (select school_admin_venues())
  );
$function$;

CREATE OR REPLACE FUNCTION public.school_admin_class(p_class uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from bookings b
      join players pl on pl.id = b.player_id
      join class_sessions cs on cs.id = b.session_id
     where cs.class_id = p_class
       and pl.client_id is null
       and pl.school_venue_id in (select school_admin_venues())
  );
$function$;

-- ── School login credentials (0062, 0063) ────────────────────────────────────
-- A school's password is shared by several people and must be re-readable, so
-- the plaintext is kept in Supabase Vault and `school_admins.password_secret_id`
-- holds only the pointer. PostgREST exposes `public` and `graphql_public` only,
-- so these four functions are the whole surface: nothing else can reach vault.*.
--
-- `current_setting('role')` is the role PostgREST switched into before the call
-- and survives the SECURITY DEFINER hop, which rewrites current_user but not
-- that GUC. Note the asymmetry: the read is founder-only on purpose, so the
-- plaintext sits behind a person rather than behind a deployment secret.

CREATE OR REPLACE FUNCTION public.set_school_password(p_user uuid, p_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.school_password(p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.clear_school_password(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  delete from vault.secrets where name = 'school_login_password:' || p_user::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_last_sign_in()
 RETURNS TABLE(school_user_id uuid, signed_in_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- Supabase grants EXECUTE on new public functions to anon, authenticated and
-- service_role by default. Nothing above is reachable with an anon key, and the
-- password read is not reachable with the service key either — the plaintext
-- sits behind a person, not behind a deployment secret. Defence in depth: the
-- same gates run inside the function bodies, which is what the local harness
-- exercises (it re-grants `public` wholesale after replaying this file).
REVOKE ALL ON FUNCTION public.set_school_password(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_school_password(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.clear_school_password(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.clear_school_password(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.school_last_sign_in() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.school_last_sign_in() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.school_password(uuid) FROM public, anon, service_role;
GRANT EXECUTE ON FUNCTION public.school_password(uuid) TO authenticated;

-- ── Web push signing keys (0064) ─────────────────────────────────────────────
-- The second thing kept in Vault, and the mirror image of the block above.
--
-- A VAPID private key belongs in a Supabase function secret; the worker reads
-- `Deno.env` first for exactly that reason, so setting a real secret takes over
-- silently. It lives here because nothing in the environment this was built from
-- could set one, and the alternative was leaving push dormant indefinitely.
--
-- Note the reversed audience, which is the part to get right. `school_password`
-- refuses service_role so a shared credential sits behind a person. This one is
-- read by the notify edge function, which connects with the service-role key and
-- is the ONLY legitimate caller — so service_role is allowed and `authenticated`
-- is refused. Backwards in one direction push never sends anything, silently;
-- backwards in the other every signed-in parent, coach and school head can push
-- an arbitrary banner to any subscribed device in the academy, wearing our name.
--
-- Nulls, not an exception, when the vault is empty: "we hold no key" is an
-- honest state and the worker answers it by skipping push, exactly as it behaved
-- before push existed. The aggregate always returns one row.

CREATE OR REPLACE FUNCTION public.vapid_keys()
 RETURNS TABLE(public_key text, private_key text, subject text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

REVOKE ALL ON FUNCTION public.vapid_keys() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vapid_keys() TO service_role;

-- The applicant's signup request: capture name + (E.164) phone, notify founders,
-- idempotent so a typo'd phone can be corrected before the founder acts. A phone
-- matching a founder pre-registration auto-approves via claim_client_invite and
-- sends no founder request. (docs/new-user-approval-plan.md)
CREATE OR REPLACE FUNCTION public.submit_signup_request(p_name text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_profile profiles%rowtype;
  v_old_name text;
  v_name text := nullif(btrim(p_name), '');
  v_status public.signup_approval_status;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'error', 'error', 'not_authenticated');
  end if;

  select * into v_profile from profiles where id = v_uid;
  if not found or v_profile.role <> 'client' then
    return jsonb_build_object('status', 'error', 'error', 'not_client');
  end if;
  if v_profile.approval_status <> 'pending' then
    return jsonb_build_object('status', v_profile.approval_status::text);
  end if;

  v_old_name := v_profile.full_name;

  update profiles set full_name = coalesce(v_name, full_name) where id = v_uid;

  if v_name is not null then
    update players set full_name = v_name
    where client_id = v_uid and full_name = v_old_name;
  end if;

  begin
    update profiles set phone = p_phone where id = v_uid;
  exception when unique_violation then
    update profiles set full_name = v_old_name where id = v_uid;
    return jsonb_build_object('status', 'error', 'error', 'phone_taken');
  end;

  select approval_status into v_status from profiles where id = v_uid;
  if v_status = 'approved' then
    return jsonb_build_object('status', 'approved');
  end if;

  update notifications
  set title = 'New signup request',
      body = coalesce(v_name, 'Someone') || ' (' || v_profile.email || ', ' || p_phone || ') wants access.',
      data = jsonb_build_object(
        'client_id', v_uid,
        'applicant_name', coalesce(v_name, v_old_name),
        'applicant_email', v_profile.email,
        'applicant_phone', p_phone,
        'url', '/admin/players?view=clients')
  where type = 'signup_request'
    and data->>'client_id' = v_uid::text
    and status = 'pending';

  if not found
     and not exists (
       select 1 from notifications
       where type = 'signup_request' and data->>'client_id' = v_uid::text
     ) then
    perform notify_founders('signup_request', 'New signup request',
      coalesce(v_name, 'Someone') || ' (' || v_profile.email || ', ' || p_phone || ') wants access.',
      jsonb_build_object(
        'client_id', v_uid,
        'applicant_name', coalesce(v_name, v_old_name),
        'applicant_email', v_profile.email,
        'applicant_phone', p_phone,
        'url', '/admin/players?view=clients'));
  end if;

  return jsonb_build_object('status', 'pending');
end;
$function$;

-- The single approve/deny implementation shared by the admin action and the
-- WhatsApp founder buttons. Idempotent: a second tap resolves to already_reviewed.
CREATE OR REPLACE FUNCTION public.review_signup_request(p_client uuid, p_approve boolean, p_reviewer uuid default auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reviewer_role public.user_role;
  v_profile profiles%rowtype;
  v_first text;
begin
  select role into v_reviewer_role from profiles where id = p_reviewer;
  if v_reviewer_role is distinct from 'founder' then
    return jsonb_build_object('ok', false, 'error', 'not_founder');
  end if;
  if p_reviewer = auth.uid() and not is_founder() then
    return jsonb_build_object('ok', false, 'error', 'not_founder');
  end if;

  select * into v_profile from profiles where id = p_client for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_profile.approval_status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'already_reviewed',
                              'status', v_profile.approval_status::text);
  end if;

  if p_approve then
    update profiles set approval_status = 'approved' where id = p_client;

    v_first := coalesce(nullif(split_part(btrim(v_profile.full_name), ' ', 1), ''), 'there');
    insert into notifications (user_id, type, title, body, data)
    values (p_client, 'signup_approved', 'You''re approved!',
      'Welcome to Sharwin TTA — tap below to finish setting up your account.',
      jsonb_build_object('first_name', v_first, 'url', '/app'));
  else
    update profiles set approval_status = 'denied' where id = p_client;
  end if;

  update notifications set read_at = now()
  where type = 'signup_request'
    and data->>'client_id' = p_client::text
    and read_at is null;

  return jsonb_build_object('ok', true,
    'status', case when p_approve then 'approved' else 'denied' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.private_minutes_balance(p_client uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(delta_minutes), 0)::int
  from private_credit_ledger
  where client_id = p_client;
$function$;

CREATE OR REPLACE FUNCTION public.private_plan_limits(p_client uuid)
 RETURNS TABLE(sessions_per_week integer, session_minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.private_sessions_per_week, p.private_session_minutes
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.client_id = p_client
    and (coalesce(p.private_minutes_per_cycle, 0) > 0
         or p.private_sessions_per_week is not null
         or p.private_session_minutes is not null)
    and (
      s.status in ('active', 'trialing')
      or (
        s.status = 'past_due'
        and s.current_period_end is not null
        and now() <= s.current_period_end
            + make_interval(days => get_setting_int('dunning_grace_days', 7))
      )
    )
  order by s.created_at desc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.public_coach_roster()
 RETURNS TABLE(id uuid, full_name text, bio text, quote text, credentials text[], photo_url text, base_lat double precision, base_lng double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, p.full_name, c.bio, c.quote, c.credentials, c.photo_url,
         c.base_lat, c.base_lng
  from public.coaches c
  join public.profiles p on p.id = c.id
  where c.active
    and p.deleted_at is null
  order by c.created_at
$function$;

CREATE OR REPLACE FUNCTION public.rank_coaches(p_session uuid, p_preferred uuid DEFAULT NULL::uuid)
 RETURNS TABLE(coach_id uuid, score numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_weights jsonb;
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_lat float8; v_lng float8;
begin
  select coalesce(
    (select value from settings where key = 'assignment_weights'),
    '{"continuity":35,"proximity":25,"load":20,"adjacency":15}'::jsonb
  ) into v_weights;

  select * into v_session from class_sessions where id = p_session;
  select * into v_class from classes where id = v_session.class_id;

  if v_class.class_type = 'private' then
    select d.lat, d.lng into v_lat, v_lng from private_class_details d where d.class_id = v_class.id;
  else
    select v.lat, v.lng into v_lat, v_lng from venues v where v.id = v_class.venue_id;
  end if;

  return query
  with pool as (
    select c.* from coaches c
    where c.active and coach_filter_failure(c.id, p_session) is null
  ),
  metrics as (
    select
      c.id,
      -- continuity: coached this class (group) or this client (private) before
      (case when v_class.class_type = 'group' then exists (
          select 1 from class_sessions s where s.class_id = v_class.id
            and s.coach_id = c.id and s.id <> p_session)
        else exists (
          select 1 from class_sessions s
          join classes c2 on c2.id = s.class_id
          join private_class_details d on d.class_id = c2.id
          where s.coach_id = c.id
            and d.client_id = (select client_id from private_class_details where class_id = v_class.id))
      end)::int as continuity,
      haversine_km(v_lat, v_lng, c.base_lat, c.base_lng) as dist,
      coalesce((
        select sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600.0)
        from class_sessions s
        where s.coach_id = c.id and s.status = 'scheduled'
          and date_trunc('week', s.starts_at at time zone 'Asia/Kolkata')
            = date_trunc('week', v_session.starts_at at time zone 'Asia/Kolkata')
      ), 0) as load_hours,
      (exists (
        select 1 from class_sessions s
        join classes c2 on c2.id = s.class_id
        left join venues v2 on v2.id = c2.venue_id
        where s.coach_id = c.id and s.status = 'scheduled' and s.id <> p_session
          and (s.starts_at at time zone 'Asia/Kolkata')::date
            = (v_session.starts_at at time zone 'Asia/Kolkata')::date
          and abs(extract(epoch from (s.starts_at - v_session.ends_at))) <= 7200
          and (c2.venue_id is not distinct from v_class.venue_id
               or (v2.lat is not null and haversine_km(v_lat, v_lng, v2.lat, v2.lng) <= 3))
      ))::int as adjacency
    from pool c
  ),
  norm as (
    select *,
      case when max(dist) over () = min(dist) over () then 1.0
           else 1.0 - (dist - min(dist) over ()) / nullif(max(dist) over () - min(dist) over (), 0) end as proximity_n,
      case when max(load_hours) over () = min(load_hours) over () then 1.0
           else 1.0 - (load_hours - min(load_hours) over ()) / nullif(max(load_hours) over () - min(load_hours) over (), 0) end as load_n
    from metrics
  )
  select
    n.id,
    round((
      (v_weights->>'continuity')::numeric * n.continuity
      + (v_weights->>'proximity')::numeric * n.proximity_n
      + (v_weights->>'load')::numeric * n.load_n
      + (v_weights->>'adjacency')::numeric * n.adjacency
      + case when p_preferred is not null and n.id = p_preferred then 40 else 0 end
    )::numeric, 2) as score
  from norm n
  order by score desc, n.load_hours asc, n.id asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_private_class(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_player uuid := (payload->>'player_id')::uuid;
  v_duration int := (payload->>'duration_minutes')::int;
  v_start timestamptz := (payload->>'starts_at')::timestamptz;
  v_preferred uuid := nullif(payload->>'preferred_coach', '')::uuid;
begin
  if v_client is null then raise exception 'not_authenticated'; end if;

  if not exists (select 1 from players where id = v_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  if v_start < now() + interval '24 hours' then
    raise exception 'lead_time_24h';
  end if;

  return _create_private_occurrence(
    v_client, v_player, v_start, v_duration,
    payload->>'address', coalesce(payload->>'postcode', ''),
    (payload->>'lat')::float8, (payload->>'lng')::float8,
    coalesce((payload->>'has_table')::boolean, true),
    payload->>'access_notes', payload->'address_details',
    v_preferred, nullif(payload->>'series_id', '')::uuid, true,
    nullif(payload->>'venue_id', '')::uuid,
    payload->>'venue_label', payload->>'unit_label');
end;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking uuid, p_target_session uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_booking bookings%rowtype;
  v_old_session class_sessions%rowtype;
  v_target class_sessions%rowtype;
  v_target_class classes%rowtype;
  v_hops int := 0;
  v_walk uuid;
  v_max_hops int := get_setting_int('reschedule_max_hops', 2);
  v_capacity int;
  v_confirmed int;
  v_new bookings%rowtype;
  v_first uuid; v_second uuid;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found or v_booking.client_id <> v_client then raise exception 'booking_not_found'; end if;
  if v_booking.status <> 'confirmed' then raise exception 'booking_not_live'; end if;

  -- hop limit (A11)
  v_walk := v_booking.rescheduled_from;
  while v_walk is not null loop
    v_hops := v_hops + 1;
    select rescheduled_from into v_walk from bookings where id = v_walk;
  end loop;
  if v_hops >= v_max_hops then raise exception 'reschedule_limit_reached'; end if;

  -- lock both sessions in consistent order (deadlock avoidance)
  if v_booking.session_id < p_target_session then
    v_first := v_booking.session_id; v_second := p_target_session;
  else
    v_first := p_target_session; v_second := v_booking.session_id;
  end if;
  perform 1 from class_sessions where id = v_first for update;
  perform 1 from class_sessions where id = v_second for update;

  select * into v_old_session from class_sessions where id = v_booking.session_id;
  if v_old_session.starts_at <= now() then raise exception 'session_started'; end if;

  select * into v_target from class_sessions where id = p_target_session;
  select * into v_target_class from classes where id = v_target.class_id;

  if v_target.status <> 'scheduled'
     or v_target.starts_at <= now() + make_interval(mins => get_setting_int('booking_cutoff_minutes', 60)) then
    raise exception 'target_not_bookable';
  end if;

  if exists (
    select 1 from bookings b
    join class_sessions cs on cs.id = b.session_id
    where b.player_id = v_booking.player_id and b.status = 'confirmed' and b.id <> p_booking
      and tstzrange(cs.starts_at, cs.ends_at) && tstzrange(v_target.starts_at, v_target.ends_at)
  ) then raise exception 'player_double_booked'; end if;

  v_capacity := coalesce(v_target.capacity_override, v_target_class.capacity);
  select count(*) into v_confirmed from bookings
  where session_id = p_target_session and status = 'confirmed';
  if v_confirmed >= v_capacity then raise exception 'target_full'; end if;

  insert into bookings (session_id, client_id, player_id, status, rescheduled_from)
  values (p_target_session, v_booking.client_id, v_booking.player_id, 'confirmed', p_booking)
  returning * into v_new;

  update bookings set status = 'rescheduled', cancelled_at = now() where id = p_booking;

  -- waitlist promotion on freed seat
  insert into notifications (user_id, type, title, body, data, scheduled_for)
  select b.client_id, 'waitlist_spot', 'A spot opened',
         'Claim it within ' || get_setting_int('waitlist_claim_minutes', 15) || ' minutes.',
         jsonb_build_object('booking_id', b.id, 'session_id', v_booking.session_id,
           'class_title', coalesce(c.title, 'a class'),
           'claim_minutes', get_setting_int('waitlist_claim_minutes', 15),
           'url', '/app/book/class/' || v_booking.session_id), now()
  from bookings b
  join class_sessions s on s.id = b.session_id
  join classes c on c.id = s.class_id
  where b.session_id = v_booking.session_id and b.status = 'waitlisted'
  order by b.waitlist_position asc limit 1;

  insert into notifications (user_id, type, title, body, data) values
    (v_client, 'booking_rescheduled', 'Rescheduled.',
     to_char(v_target.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am'),
     jsonb_build_object('booking_id', v_new.id, 'url', '/app/schedule'));

  -- fresh reminder; sweep old ones (keep legacy types for in-flight rows)
  delete from notifications where status = 'pending'
    and (data->>'booking_id')::uuid = p_booking
    and type in ('reminder_24h', 'reminder_2h', 'reminder_upcoming');
  insert into notifications (user_id, type, title, body, data, scheduled_for) values
    (v_client, 'reminder_upcoming', 'Later today', v_target_class.title,
     jsonb_build_object('booking_id', v_new.id, 'session_id', p_target_session,
       'class_title', v_target_class.title,
       'time_str', to_char(v_target.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
       'url', '/app/schedule'),
     v_target.starts_at - interval '3 hours');

  return v_new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_private_session(p_session uuid, p_new_start timestamp with time zone, p_confirm boolean DEFAULT false)
 RETURNS TABLE(proposed_coach uuid, coach_changed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_session class_sessions%rowtype;
  v_class classes%rowtype;
  v_old_coach uuid;
  v_new_coach uuid;
  v_new_end timestamptz;
  v_fail text;
begin
  select * into v_session from class_sessions where id = p_session for update;
  if not found then raise exception 'session_not_found'; end if;
  select * into v_class from classes where id = v_session.class_id;

  if not exists (
    select 1 from private_class_details d
    where d.class_id = v_class.id and d.client_id = v_client
  ) then raise exception 'not_your_session'; end if;

  if p_new_start < now() + interval '24 hours' then
    raise exception 'lead_time_24h';
  end if;

  v_old_coach := v_session.coach_id;
  v_new_end := p_new_start + make_interval(mins => v_class.duration_minutes);

  -- Same-coach first (hard filters at the new time), else engine scoring.
  if v_old_coach is not null then
    -- Temporarily test the coach against the new window via a lightweight check
    v_fail := null;
    if exists (
      select 1 from class_sessions s2
      where s2.coach_id = v_old_coach and s2.status = 'scheduled' and s2.id <> p_session
        and tstzrange(s2.starts_at, s2.ends_at) && tstzrange(p_new_start, v_new_end)
    ) then v_fail := 'overlap'; end if;
    if v_fail is null then v_new_coach := v_old_coach; end if;
  end if;

  if v_new_coach is null then
    -- score candidates for the new time by moving the window transiently
    -- (preview-safe: inside a transaction; rolled back unless confirmed)
    update class_sessions set starts_at = p_new_start, ends_at = v_new_end, coach_id = null
    where id = p_session;
    select rc.coach_id into v_new_coach from rank_coaches(p_session) rc limit 1;
    if not p_confirm then
      -- undo the transient move for preview
      update class_sessions set starts_at = v_session.starts_at, ends_at = v_session.ends_at,
        coach_id = v_old_coach where id = p_session;
      return query select v_new_coach, (v_new_coach is distinct from v_old_coach);
      return;
    end if;
  elsif not p_confirm then
    return query select v_new_coach, false;
    return;
  end if;

  if v_new_coach is null then raise exception 'no_coach_available'; end if;

  update class_sessions
  set starts_at = p_new_start, ends_at = v_new_end, coach_id = v_new_coach
  where id = p_session;

  update coach_assignments set status = 'superseded'
  where session_id = p_session and status = 'active' and coach_id is distinct from v_new_coach;
  insert into coach_assignments (session_id, coach_id, assigned_by, status)
  select p_session, v_new_coach, v_client, 'active'
  where not exists (
    select 1 from coach_assignments
    where session_id = p_session and status = 'active' and coach_id = v_new_coach
  );

  insert into notifications (user_id, type, title, body, data) values
    (v_client, 'booking_rescheduled', 'Rescheduled.',
     to_char(p_new_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am'),
     jsonb_build_object('session_id', p_session, 'url', '/app/schedule'));
  if v_old_coach is not null and v_old_coach <> v_new_coach then
    insert into notifications (user_id, type, title, body, data) values
      (v_old_coach, 'coach_changed', 'Session moved',
       'A private session was rescheduled away from you.',
       jsonb_build_object('session_id', p_session, 'url', '/coach/calendar'));
  end if;
  insert into notifications (user_id, type, title, body, data) values
    (v_new_coach, 'new_private_session', 'Private session (rescheduled)',
     to_char(p_new_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am'),
     jsonb_build_object('session_id', p_session, 'url', '/coach/session/' || p_session));

  return query select v_new_coach, (v_new_coach is distinct from v_old_coach);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_series(p_booking uuid, p_target_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid := auth.uid();
  v_booking bookings%rowtype;
  v_result bookings%rowtype;
  v_target class_sessions%rowtype;
  v_new jsonb;
begin
  select * into v_booking from bookings where id = p_booking;
  if not found or v_booking.client_id <> v_client then raise exception 'booking_not_found'; end if;

  -- 1) move this week via the existing atomic single-move (validates target/hops)
  v_result := reschedule_booking(p_booking, p_target_session);

  -- 2) tear down the old standing series (frees other future weeks)
  if v_booking.series_id is not null then
    perform cancel_series(v_booking.series_id);
  end if;

  -- 3) stand up a new series on the target slot and enrol its future weeks.
  --    The immediate target week is already booked by step 1; book_series will
  --    skip it as a duplicate and enrol the remaining future occurrences.
  select * into v_target from class_sessions where id = p_target_session;
  v_new := book_series(p_target_session, v_booking.player_id, true);

  return jsonb_build_object('moved_booking', v_result.id, 'series', v_new);
end;
$function$;

-- Runs hourly at :05 (cron job `session-status-hourly`, migration 0065). Until
-- then it had never run at all, so a session only ever left 'scheduled' when a
-- coach tapped a register — which is how hundreds of finished sessions came to
-- read as still-to-come and pin their classes to the founder's list.
--
-- It closes sessions and does NOTHING else. The 0006 version had a second
-- statement defaulting un-marked attendance to 'attended' after 48h; that was
-- deliberately dropped, because 'attended' is what a parent, a school and the
-- WhatsApp bot are told about a child, and inventing one is indistinguishable
-- afterwards from a register somebody actually kept. 0065 records what would
-- have to exist before it could come back.
CREATE OR REPLACE FUNCTION public.sweep_session_status()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update class_sessions set status = 'completed'
  where status = 'scheduled' and ends_at < now();
$function$;

COMMENT ON FUNCTION public.sweep_session_status() IS 'Closes past scheduled sessions to completed, hourly. Deliberately does NOT default un-marked attendance — see migration 0065.';

-- Maintenance only: cron runs it as the job owner, and nothing in the app calls
-- it. It carried PUBLIC execute from 0006 while it was dead code; scheduling it
-- made that a writable SECURITY DEFINER function reachable anonymously (0066).
revoke execute on function public.sweep_session_status() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coach_mark_arrival(p_session uuid, p_late boolean DEFAULT false, p_source text DEFAULT 'tap'::text, p_distance_m integer DEFAULT NULL::integer)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_coach   uuid;
  v_starts  timestamptz;
  v_class   uuid;
  v_name    text;
  v_location text;
  v_time    text;
  v_type    text;
  v_title   text;
  v_body    text;
  v_arrived timestamptz;
begin
  select coach_id, starts_at, class_id
    into v_coach, v_starts, v_class
    from class_sessions where id = p_session;

  if v_coach is null or v_coach <> auth.uid() then
    raise exception 'not_your_session';
  end if;

  select split_part(coalesce(nullif(trim(full_name), ''), 'Your coach'), ' ', 1)
    into v_name
    from profiles where id = v_coach;

  v_location := coalesce(class_location_label(v_class), 'the venue');

  v_time := to_char(v_starts at time zone 'Asia/Kolkata', 'FMHH12:MI AM');

  if p_late then
    -- Late implies coming, exactly as arrived does. Recording BOTH is what
    -- stops the founder escalation calling this coach silent, and stops the
    -- confirm ladder chasing someone who has already answered.
    -- coach_arrived_at is deliberately untouched: they are not there yet, and
    -- the start+10 escalation still needs to fire if they never turn up. It
    -- just has to say something true when it does.
    update class_sessions
       set coach_late_at      = coalesce(coach_late_at, now()),
           coach_confirmed_at = coalesce(coach_confirmed_at, now())
     where id = p_session;
    v_type  := 'coach_late';
    v_title := 'Coach running late';
    v_body  := 'Coach ' || v_name || ' is running a few minutes late for the '
               || v_time || ' session.';
  else
    -- Arrived implies coming: also stamp confirm + provenance so a coach who
    -- only ever taps "arrived" is never nagged or escalated as unconfirmed.
    update class_sessions
       set coach_arrived_at        = coalesce(coach_arrived_at, now()),
           coach_confirmed_at       = coalesce(coach_confirmed_at, now()),
           coach_arrival_source     = coalesce(coach_arrival_source, p_source),
           coach_arrival_distance_m = coalesce(coach_arrival_distance_m, p_distance_m)
     where id = p_session
     returning coach_arrived_at into v_arrived;
    v_type  := 'coach_arrived';
    v_title := 'Coach has arrived';
    v_body  := 'Coach ' || v_name || ' is at ' || v_location
               || ' for the ' || v_time || ' session.';
  end if;

  -- Booked clients (parents) are always told — arrived or late both matter to
  -- them. Auto arrivals delay 2 minutes so an Undo beats delivery; manual and
  -- WhatsApp taps notify immediately. Data carries coach_name/location/time so
  -- the notify worker can render the parent WhatsApp without re-querying.
  insert into notifications (user_id, type, title, body, data, scheduled_for)
  select distinct b.client_id, v_type, v_title, v_body,
         jsonb_build_object('session_id', p_session, 'url', '/app',
           'coach_name', v_name, 'location_str', v_location, 'time_str', v_time),
         case when p_source = 'auto' then now() + interval '2 minutes' else now() end
    from bookings b
   where b.session_id = p_session
     and b.status in ('confirmed', 'attended');

  -- Founders are pinged ONLY when the coach is running late (they may need to
  -- act). A normal on-time arrival needs no founder ping; the notify worker
  -- escalates separately if the class starts with no arrival marked.
  if p_late then
    insert into notifications (user_id, type, title, body, data)
    select p.id, v_type, v_title, v_body,
           jsonb_build_object('session_id', p_session, 'url', '/admin/schedule')
      from profiles p where p.role = 'founder';
  end if;

  return v_arrived;
end;
$function$;

CREATE OR REPLACE FUNCTION public.coach_undo_arrival(p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_coach   uuid;
  v_arrived timestamptz;
begin
  select coach_id, coach_arrived_at
    into v_coach, v_arrived
    from class_sessions where id = p_session;

  if v_coach is null or v_coach <> auth.uid() then
    raise exception 'not_your_session';
  end if;

  if v_arrived is null or now() - v_arrived > interval '10 minutes' then
    raise exception 'undo_window_passed';
  end if;

  -- Clear the arrival but keep coach_confirmed_at — the coach is still coming.
  update class_sessions
     set coach_arrived_at        = null,
         coach_arrival_source     = null,
         coach_arrival_distance_m = null
   where id = p_session;

  -- Still-pending parent notification rows can be pulled; already-sent rows are
  -- too late (acceptable).
  delete from notifications
   where type = 'coach_arrived'
     and status = 'pending'
     and data->>'session_id' = p_session::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_player_notes(p_player uuid)
 RETURNS TABLE(id uuid, body text, created_at timestamptz, author_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (
    is_coach() or is_founder()
    or exists (
      select 1 from players pl
       where pl.id = p_player and pl.client_id = auth.uid()
    )
    or (is_school_admin() and school_has_player(p_player))
  ) then
    raise exception 'not_authorised';
  end if;

  return query
    select n.id, n.body, n.created_at,
           coalesce(nullif(trim(p.full_name), ''), 'Coach') as author_name
      from student_notes n
      left join profiles p on p.id = n.author_id
     where n.player_id = p_player
     order by n.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_coach_invite_on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite public.coach_invites%rowtype;
  v_name text := split_part(new.email, '@', 1);
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
      id, bio, base_lat, base_lng, base_address, active
    )
    values (
      new.id,
      v_invite.bio,
      coalesce(v_invite.base_lat, 12.9716),
      coalesce(v_invite.base_lng, 77.5946),
      v_invite.base_address,
      true
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

-- ── Founder ops feed (0018) — helpers, coach confirmation, event triggers ────

CREATE OR REPLACE FUNCTION public.fmt_ist(ts timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select to_char(ts at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI am');
$function$;

CREATE OR REPLACE FUNCTION public.fmt_inr(p_paise integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select '₹' || to_char(round(p_paise / 100.0), 'FM9999999990');
$function$;

CREATE OR REPLACE FUNCTION public.notify_founders(p_type text, p_title text, p_body text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into notifications (user_id, type, title, body, data)
  select p.id, p_type, p_title, p_body, p_data
  from profiles p
  where p.role = 'founder' and p.deleted_at is null;
$function$;

CREATE OR REPLACE FUNCTION public.session_label(p_session uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.title || ', ' || fmt_ist(s.starts_at)
         || coalesce(' at ' || nullif(class_location_label(c.id), ''), '')
  from class_sessions s
  join classes c on c.id = s.class_id
  where s.id = p_session;
$function$;

COMMENT ON FUNCTION public.session_label IS
  'Human name for a session: title, IST start, and location_label. Used by the '
  'notify_name_the_session trigger so a message never says "one of your sessions".';

CREATE OR REPLACE FUNCTION public.notify_name_the_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session uuid;
  v_label   text;
  v_title   text;
  v_time    text;
  v_where   text;
  v_coach   uuid;
  v_coach_name text;
begin
  if new.type not in ('reminder_upcoming', 'coach_changed') then
    return new;
  end if;

  v_session := nullif(new.data ->> 'session_id', '')::uuid;
  if v_session is null then return new; end if;

  select c.title,
         to_char(s.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
         nullif(class_location_label(c.id), ''),
         s.coach_id
    into v_title, v_time, v_where, v_coach
  from class_sessions s
  join classes c on c.id = s.class_id
  where s.id = v_session;

  if v_title is null then return new; end if;   -- session vanished; leave as-is

  if new.type = 'reminder_upcoming' then
    new.body := v_title || ' at ' || v_time
                || coalesce(' — ' || v_where, '') || '.';
    new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
      'class_title',  v_title,
      'time_str',     v_time,
      'location_str', v_where));
    return new;
  end if;

  -- coach_changed
  v_label := v_title || ', ' || fmt_ist(
    (select starts_at from class_sessions where id = v_session))
    || coalesce(' at ' || v_where, '');

  new.body := rtrim(new.body, ' .') || ' — ' || v_label || '.';

  if v_coach is not null and v_coach <> new.user_id then
    select split_part(nullif(btrim(full_name), ''), ' ', 1)
      into v_coach_name from profiles where id = v_coach;
    if v_coach_name is not null then
      new.body := new.body || ' New coach: ' || v_coach_name || '.';
    end if;
  end if;

  new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
    'class_title',   v_title,
    'time_str',      v_time,
    'location_str',  v_where,
    'session_label', v_label,
    'coach_name',    v_coach_name));

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.founder_day_report(p_date date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date)
 RETURNS TABLE(session_id uuid, class_title text, coach_id uuid, coach_name text, starts_at timestamp with time zone, time_str text, confirmed_at timestamp with time zone, arrived_at timestamp with time zone, minutes_late integer, arrival_source text, distance_m integer, roster_size integer, roster_marked integer)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    s.id,
    c.title,
    s.coach_id,
    -- NULL for an unassigned session (0067). Was coalesce(..., 'Unassigned'),
    -- which made a scheduling gap indistinguishable from a coach who ignored
    -- the arrival prompt.
    case when s.coach_id is null
         then null
         else coalesce(nullif(btrim(p.full_name), ''), 'Coach')
    end,
    s.starts_at,
    to_char(s.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
    s.coach_confirmed_at,
    s.coach_arrived_at,
    -- NULL when they never marked arrival at all: "late" and "absent" are
    -- different facts and the caller must be able to tell them apart.
    case
      when s.coach_arrived_at is null then null
      else greatest(0, (extract(epoch from s.coach_arrived_at - s.starts_at) / 60)::int)
    end,
    s.coach_arrival_source,
    s.coach_arrival_distance_m,
    (select count(*)::int from bookings b
      where b.session_id = s.id
        and b.status in ('confirmed', 'attended', 'no_show')),
    -- Attendance is bookings.status, so "marked" means moved off 'confirmed'.
    (select count(*)::int from bookings b
      where b.session_id = s.id
        and b.status in ('attended', 'no_show'))
  from class_sessions s
  join classes c on c.id = s.class_id
  left join profiles p on p.id = s.coach_id
  where s.status <> 'cancelled'
    and (s.starts_at at time zone 'Asia/Kolkata')::date = p_date
  order by s.starts_at;
$function$;

COMMENT ON FUNCTION public.founder_day_report IS
  'Per-session punctuality and roster-completion facts for one IST day. Backs '
  'the 21:00 founder summary (sweepFounderDigest). Replaces a row count that '
  'excluded every coach escalation. coach_name is NULL for an unassigned '
  'session so the caller can separate a scheduling gap from a coach no-show.';

-- Founders only; the digest sweep runs as service-role.
REVOKE ALL ON FUNCTION public.founder_day_report(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.founder_day_report(date) TO service_role;

CREATE OR REPLACE FUNCTION public.coach_confirm_session(p_session uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session class_sessions%rowtype;
  v_at      timestamptz;
begin
  select * into v_session from class_sessions where id = p_session;
  if v_session.coach_id is null or v_session.coach_id <> auth.uid() then
    raise exception 'not_your_session';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'session_not_scheduled';
  end if;

  update class_sessions
     set coach_confirmed_at = coalesce(coach_confirmed_at, now())
   where id = p_session
   returning coach_confirmed_at into v_at;

  -- Founders are intentionally NOT notified: a routine confirmation needs no
  -- action from them. The notify worker escalates only when a coach has still
  -- not confirmed ~10 minutes before the class starts.
  return v_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reset_session_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.coach_id is distinct from old.coach_id
     or new.starts_at is distinct from old.starts_at then
    new.coach_confirmed_at := null;
    new.coach_arrived_at := null;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_new_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.role = 'client' then
    perform notify_founders('ops_new_client', 'New client signed up',
      new.full_name || ' (' || new.email
      || coalesce(', ' || nullif(new.phone, ''), '') || ') just created an account.',
      jsonb_build_object('client_id', new.id, 'url', '/admin/clients'));
  elsif new.role = 'coach' then
    perform notify_founders('ops_new_coach', 'New coach joined',
      new.full_name || ' (' || new.email
      || coalesce(', ' || nullif(new.phone, ''), '') || ') is now on the coach roster.',
      jsonb_build_object('coach_id', new.id, 'url', '/admin/coaches'));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_new_player()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client profiles%rowtype;
begin
  select * into v_client from profiles where id = new.client_id;
  if not found then return new; end if;
  -- Skip the default player auto-created at signup (same name, same moment) —
  -- the ops_new_client message already covers it.
  if new.full_name = v_client.full_name
     and new.created_at < v_client.created_at + interval '2 minutes' then
    return new;
  end if;
  perform notify_founders('ops_player_added', 'Player added',
    v_client.full_name || ' added ' || new.full_name || ' to their household.',
    jsonb_build_object('client_id', new.client_id, 'player_id', new.id, 'url', '/admin/clients'));
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_credit_used()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client text;
  v_player text;
begin
  if old.consumed_at is not null or new.consumed_at is null then return new; end if;
  select full_name into v_client from profiles where id = new.client_id;
  select full_name into v_player from players where id = new.player_id;
  perform notify_founders('ops_credit_used',
    case new.type when 'group_trial' then 'Free trial used' else 'Drop-in used' end,
    coalesce(v_client, 'A client')
    || case when v_player is not null and v_player <> v_client then ' (' || v_player || ')' else '' end
    || case new.type
         when 'group_trial' then ' booked their FREE TRIAL class.'
         else ' used a drop-in class credit.'
       end,
    jsonb_build_object('client_id', new.client_id, 'url', '/admin/clients'));
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_booking_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session   class_sessions%rowtype;
  v_class     classes%rowtype;
  v_player    text;
  v_client    text;
  v_where     text;
  v_cap       integer;
  v_confirmed integer;
  v_title     text;
  v_verb      text;
begin
  select * into v_session from class_sessions where id = new.session_id;
  if not found or v_session.status <> 'scheduled' then return new; end if;
  select * into v_class from classes where id = v_session.class_id;
  select full_name into v_player from players where id = new.player_id;
  select full_name into v_client from profiles where id = new.client_id;

  -- For series bookings, only notify the founder on the first session booked.
  -- Subsequent inserts in the same series (same transaction) would otherwise
  -- flood WhatsApp with one message per future occurrence.
  if new.series_id is not null then
    if exists (select 1 from bookings where series_id = new.series_id and id <> new.id) then
      return new;
    end if;
  end if;
  if new.private_series_id is not null then
    if exists (select 1 from bookings where private_series_id = new.private_series_id and id <> new.id) then
      return new;
    end if;
  end if;

  v_where := class_location_label(v_class.id);

  v_cap := coalesce(v_session.capacity_override, v_class.capacity);
  select count(*) into v_confirmed
  from bookings where session_id = new.session_id and status = 'confirmed';

  if new.status = 'waitlisted' then
    v_title := 'Waitlist join'; v_verb := 'joined the waitlist for';
  elsif new.rescheduled_from is not null then
    v_title := 'Booking rescheduled'; v_verb := 'rescheduled into';
  else
    v_title := 'New booking'; v_verb := 'booked';
  end if;

  perform notify_founders('ops_booking', v_title,
    coalesce(v_client, 'A client')
    || case when v_player is not null and v_player <> v_client then ' (' || v_player || ')' else '' end
    || ' ' || v_verb || ' '
    || v_class.title || case v_class.class_type when 'private' then ' [private]' else '' end
    || ' — ' || fmt_ist(v_session.starts_at)
    || coalesce(' at ' || v_where, '')
    || case when v_class.class_type = 'group'
            then ' · now ' || v_confirmed || '/' || v_cap else '' end
    || '.',
    jsonb_build_object('booking_id', new.id, 'session_id', new.session_id,
                       'client_id', new.client_id, 'url', '/admin/calendar'));
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_booking_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_player  text;
  v_client  text;
  v_who     text;
  v_first   text;
  v_when    text;
  v_note    text;
begin
  if old.status = new.status then return new; end if;
  -- cancelled_by_academy is founder-initiated (already knows); rescheduled is
  -- reported by the paired new booking's insert.
  if new.status not in ('cancelled_by_client', 'attended', 'no_show', 'confirmed') then
    return new;
  end if;
  -- attendance auto-marked by the sweep (no acting user) stays silent
  if new.status in ('attended', 'no_show') and auth.uid() is null then return new; end if;
  -- only waitlist→confirmed promotions are interesting among confirms
  if new.status = 'confirmed' and old.status <> 'waitlisted' then return new; end if;

  select * into v_session from class_sessions where id = new.session_id;
  if not found then return new; end if;
  select * into v_class from classes where id = v_session.class_id;
  select full_name into v_player from players where id = new.player_id;
  select full_name into v_client from profiles where id = new.client_id;
  v_who := coalesce(v_client, 'A client')
    || case when v_player is not null and v_player <> v_client then ' (' || v_player || ')' else '' end;

  v_first := split_part(coalesce(nullif(trim(v_player), ''), 'Your player'), ' ', 1);
  v_when  := fmt_ist(v_session.starts_at);

  if new.status = 'cancelled_by_client' then
    perform notify_founders('ops_cancellation', 'Booking cancelled',
      v_who || ' cancelled ' || v_class.title
      || ' — ' || fmt_ist(v_session.starts_at)
      || coalesce('. Reason: ' || nullif(new.cancel_reason, ''), '') || '.',
      jsonb_build_object('booking_id', new.id, 'session_id', new.session_id,
                         'client_id', new.client_id, 'url', '/admin/calendar'));
  elsif new.status = 'attended' then
    perform notify_founders('ops_attendance', 'Attendance marked',
      coalesce(v_player, 'A player') || ' attended ' || v_class.title
      || ' (' || fmt_ist(v_session.starts_at) || ').',
      jsonb_build_object('booking_id', new.id, 'session_id', new.session_id, 'url', '/admin/calendar'));

    -- C11 positive. "What was worked on" comes from the coach's note for this
    -- player, if they wrote one after the session started — so the message
    -- carries real substance when it exists and degrades to a clean
    -- confirmation when it doesn't.
    select body into v_note
      from student_notes
     where player_id = new.player_id
       and author_id = v_session.coach_id
       and created_at >= v_session.starts_at
     order by created_at desc
     limit 1;

    if new.client_id is not null then
      insert into notifications (user_id, type, title, body, data)
      values (new.client_id, 'session_outcome',
        v_first || ' was at ' || v_class.title,
        v_first || ' attended ' || v_class.title || ' (' || v_when || ').'
        || coalesce(' Coach''s note: ' || nullif(trim(v_note), ''), ''),
        jsonb_build_object('booking_id', new.id, 'session_id', new.session_id,
                           'player_id', new.player_id,
                           'player_name', v_first,
                           'class_title', v_class.title,
                           'time_str', v_when,
                           'coach_note', nullif(trim(v_note), ''),
                           'url', '/app/players'));
    end if;

  elsif new.status = 'no_show' then
    perform notify_founders('ops_attendance', 'No-show',
      coalesce(v_player, 'A player') || ' did NOT show for ' || v_class.title
      || ' (' || fmt_ist(v_session.starts_at) || ').',
      jsonb_build_object('booking_id', new.id, 'session_id', new.session_id, 'url', '/admin/calendar'));

    -- C11 / M1 — the message this whole item exists for. Copy is deliberately
    -- non-accusatory and opens a reply channel: the parent may know something
    -- we don't, and the marking may simply be wrong.
    if new.client_id is not null then
      insert into notifications (user_id, type, title, body, data)
      values (new.client_id, 'player_absent',
        v_first || ' wasn''t at today''s class',
        'We marked ' || v_first || ' absent for ' || v_class.title || ' (' || v_when
        || '). If that''s a mistake or something''s up, just reply here — we''ll sort it.',
        jsonb_build_object('booking_id', new.id, 'session_id', new.session_id,
                           'player_id', new.player_id,
                           'player_name', v_first,
                           'class_title', v_class.title,
                           'time_str', v_when,
                           'url', '/app/schedule'));
    end if;

  else -- waitlisted → confirmed
    perform notify_founders('ops_booking', 'Waitlist spot claimed',
      v_who || ' claimed the freed spot in ' || v_class.title
      || ' — ' || fmt_ist(v_session.starts_at) || '.',
      jsonb_build_object('booking_id', new.id, 'session_id', new.session_id,
                         'client_id', new.client_id, 'url', '/admin/calendar'));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_coach_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_class    text;
  v_old_name text;
  v_new_name text;
begin
  if old.coach_id is not distinct from new.coach_id then return new; end if;
  -- Only near-term sessions: keeps weekly top-up + engine churn out of the feed.
  if new.status <> 'scheduled'
     or new.starts_at <= now()
     or new.starts_at > now() + interval '7 days' then
    return new;
  end if;

  select title into v_class from classes where id = new.class_id;
  select full_name into v_old_name from profiles where id = old.coach_id;
  select full_name into v_new_name from profiles where id = new.coach_id;

  perform notify_founders('ops_coach_change',
    case when new.coach_id is null then 'Session needs cover' else 'Coach assigned' end,
    coalesce(v_class, 'Session') || ' — ' || fmt_ist(new.starts_at) || ': '
    || coalesce(v_old_name, 'unassigned') || ' → '
    || coalesce(v_new_name, 'UNASSIGNED (needs cover)') || '.',
    jsonb_build_object('session_id', new.id, 'url', '/admin/calendar'));
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client text;
  v_plan   plans%rowtype;
  v_label  text;
begin
  select full_name into v_client from profiles where id = new.client_id;
  select * into v_plan from plans where id = new.plan_id;
  v_label := coalesce(v_plan.name, 'a plan') || ' (' || fmt_inr(coalesce(v_plan.price_pence, 0))
    || '/mo' || case when new.source = 'comp' then ', comp' else '' end || ')';

  if tg_op = 'INSERT' then
    if new.status in ('active', 'trialing') then
      perform notify_founders('ops_membership', 'New membership',
        coalesce(v_client, 'A client') || ' started ' || v_label || '.',
        jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));
    end if;
    return new;
  end if;

  if old.status = new.status then return new; end if;

  if new.status = 'active' and old.status = 'incomplete' then
    perform notify_founders('ops_membership', 'New membership',
      coalesce(v_client, 'A client') || ' started ' || v_label || '.',
      jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));
  elsif new.status = 'active' and old.status in ('past_due', 'paused') then
    perform notify_founders('ops_membership', 'Membership recovered',
      coalesce(v_client, 'A client') || '''s ' || coalesce(v_plan.name, 'plan')
      || ' is active again.',
      jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));
  elsif new.status = 'past_due' then
    perform notify_founders('ops_payment_issue', 'Payment past due',
      coalesce(v_client, 'A client') || '''s ' || coalesce(v_plan.name, 'plan')
      || ' payment failed — Razorpay is retrying; grace period applies.',
      jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));
    insert into notifications (user_id, type, title, body, data)
    values (new.client_id, 'payment_failed', 'Payment issue',
      'Your ' || coalesce(v_plan.name, 'membership')
      || ' payment didn''t go through. Please update your payment method to keep booking.',
      jsonb_build_object('url', '/app/billing',
                         'plan_name', coalesce(v_plan.name, 'your membership')));
  elsif new.status = 'canceled' then
    perform notify_founders('ops_membership', 'Membership cancelled',
      coalesce(v_client, 'A client') || ' — ' || coalesce(v_plan.name, 'plan') || ' is cancelled.',
      jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));
  elsif new.status = 'paused' then
    perform notify_founders('ops_membership', 'Membership paused',
      coalesce(v_client, 'A client') || ' — ' || coalesce(v_plan.name, 'plan') || ' is paused.',
      jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client text;
  v_plan   text;
  v_until  text;
begin
  -- One-off purchases are reported via the orders trigger; this covers renewals.
  if new.status <> 'paid' or new.subscription_id is null then return new; end if;
  select full_name into v_client from profiles where id = new.client_id;
  select p.name, to_char(s.current_period_end at time zone 'Asia/Kolkata', 'FMDD Mon')
    into v_plan, v_until
  from subscriptions s join plans p on p.id = s.plan_id
  where s.id = new.subscription_id;
  perform notify_founders('ops_payment', 'Payment received',
    fmt_inr(new.amount_pence) || ' from ' || coalesce(v_client, 'a client')
    || ' — ' || coalesce(v_plan, 'membership') || ' renewal.',
    jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));

  -- The client's own receipt (0048). Money previously only ever generated a
  -- message when it FAILED.
  if new.client_id is not null then
    insert into notifications (user_id, type, title, body, data)
    values (new.client_id, 'payment_receipt',
      'Payment received — thank you!',
      fmt_inr(new.amount_pence) || ' for ' || coalesce(v_plan, 'your membership')
      || coalesce('. You''re covered through ' || v_until, '') || '.',
      jsonb_build_object('amount_str', fmt_inr(new.amount_pence),
                         'plan_name', v_plan,
                         'covered_until', v_until,
                         'url', '/app/billing'));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_order_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client  text;
  v_player  text;
  v_product text;
begin
  if new.status <> 'paid' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'paid' then return new; end if;
  select full_name into v_client from profiles where id = new.client_id;
  select full_name into v_player from players where id = new.player_id;
  select name into v_product from products where id = new.product_id;
  perform notify_founders('ops_payment', 'One-off purchase',
    coalesce(v_client, 'A client') || ' bought ' || coalesce(v_product, new.product_id)
    || ' (' || fmt_inr(new.amount_pence) || ')'
    || coalesce(' for ' || v_player, '') || '.',
    jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));

  -- The client's own receipt (0048).
  if new.client_id is not null then
    insert into notifications (user_id, type, title, body, data)
    values (new.client_id, 'payment_receipt',
      'Payment received — thank you!',
      fmt_inr(new.amount_pence) || ' for ' || coalesce(v_product, 'your purchase')
      || coalesce(' (' || v_player || ')', '') || '.',
      jsonb_build_object('amount_str', fmt_inr(new.amount_pence),
                         'plan_name', v_product,
                         'url', '/app/billing'));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_class_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_venue text;
  v_when  text;
  v_body  text;
begin
  if not new.active or new.is_school or new.class_type <> 'group' then
    return new;
  end if;

  select name into v_venue from venues where id = new.venue_id;
  v_when := to_char(new.starts_on, 'FMDay FMDD Mon');

  v_body := 'A new ' || new.skill_level || ' class is open: ' || new.title
    || coalesce(' at ' || v_venue, '')
    || ', starting ' || v_when || '. Book a spot while there''s room.';

  insert into notifications (user_id, type, title, body, data)
  select distinct pl.client_id, 'new_class_open', 'New class open', v_body,
         jsonb_build_object('class_id', new.id,
                            'class_title', new.title,
                            'skill_level', new.skill_level,
                            'venue_name', v_venue,
                            'starts_on', new.starts_on,
                            'url', '/app/book')
    from players pl
    join profiles pr on pr.id = pl.client_id
   where pl.client_id is not null
     and pr.role = 'client'
     and pl.skill_level = new.skill_level
     and pl.school_venue_id is null;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_assessment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid;
  v_first  text;
  v_coach  text;
  v_skills int;
begin
  select client_id, split_part(full_name, ' ', 1) into v_client, v_first
    from players where id = new.player_id;
  if v_client is null then return new; end if;

  if exists (
    select 1 from notifications
     where user_id = v_client
       and type = 'assessment_ready'
       and data->>'player_id' = new.player_id::text
       and created_at > now() - interval '7 days'
  ) then
    return new;
  end if;

  select split_part(full_name, ' ', 1) into v_coach from profiles where id = new.coach_id;
  select count(*) into v_skills from skill_ratings where assessment_id = new.id;

  insert into notifications (user_id, type, title, body, data)
  values (v_client, 'assessment_ready',
    v_first || '''s progress was updated',
    'Coach ' || coalesce(v_coach, 'your coach') || ' filed a new assessment for '
    || v_first || coalesce(' across ' || nullif(v_skills, 0) || ' skills', '')
    || '. See how they''re getting on.',
    jsonb_build_object('player_id', new.player_id,
                       'player_name', v_first,
                       'coach_name', v_coach,
                       'assessment_id', new.id,
                       'skill_count', v_skills,
                       'url', '/app/players'));
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_notify_student_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid;
  v_first  text;
  v_author text;
begin
  select client_id, split_part(full_name, ' ', 1) into v_client, v_first
    from players where id = new.player_id;
  if v_client is null then return new; end if;
  if new.author_id = v_client then return new; end if;

  -- Don't duplicate a note session_outcome is already quoting.
  if exists (
    select 1 from notifications
     where user_id = v_client
       and type = 'session_outcome'
       and data->>'player_id' = new.player_id::text
       and created_at > now() - interval '6 hours'
  ) then
    return new;
  end if;

  select split_part(full_name, ' ', 1) into v_author from profiles where id = new.author_id;

  insert into notifications (user_id, type, title, body, data)
  values (v_client, 'student_note',
    'A note about ' || v_first,
    'Coach ' || coalesce(v_author, 'your coach') || ' left a note for ' || v_first
    || ': "' || left(trim(new.body), 300) || '"',
    jsonb_build_object('player_id', new.player_id,
                       'player_name', v_first,
                       'coach_name', v_author,
                       'note_id', new.id,
                       'url', '/app/players'));
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_players_mastery(p_players uuid[])
 RETURNS TABLE(player_id uuid, mastery integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with authorized as (
    select pl.id from players pl
    where pl.id = any(p_players)
      and (
        is_founder()
        or (is_coach() and coach_has_player(pl.id))
        or pl.client_id = auth.uid()
        or (is_school_admin() and school_has_player(pl.id))
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
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_assessments(p_coach uuid DEFAULT auth.uid())
 RETURNS TABLE(player_id uuid, player_name text, session_id uuid, class_title text, session_ended_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- Everything a coach still owes on classes that ended in the last 7 days —
-- attendance AND assessments, in one read (migration 0077). A superset of
-- get_pending_assessments above, which is kept because the WhatsApp after-class
-- reply composes its "rate X next" link from it.
--
-- Attendance rows sort first because they gate the assessments behind them: an
-- unmarked roster has no attended bookings, so its assessment rows cannot exist
-- until it is done. That is what lets the in-app prompt cycle to genuinely
-- empty rather than stalling on work the coach cannot yet see.
create or replace function public.get_coach_wrapup_queue(p_coach uuid default auth.uid())
returns table(
  kind text,
  session_id uuid,
  class_title text,
  session_ended_at timestamptz,
  player_id uuid,
  player_name text,
  pending_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_coach <> auth.uid() and not is_founder() then
    raise exception 'not_authorised';
  end if;

  return query
  select 'attendance'::text,
         s.id,
         c.title,
         s.ends_at,
         null::uuid,
         null::text,
         count(*)::integer
    from bookings b
    join class_sessions s on s.id = b.session_id
    join classes c on c.id = s.class_id
   where s.coach_id = p_coach
     and b.status = 'confirmed'
     and s.ends_at < now()
     and s.ends_at > now() - interval '7 days'
   group by s.id, c.title, s.ends_at

  union all

  select 'assessment'::text,
         s.id,
         c.title,
         s.ends_at,
         b.player_id,
         pl.full_name,
         1
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

  order by 1 asc, 4 asc, 6 asc;
end;
$function$;

-- File or amend one coach's assessment of one player for one session
-- (migrations 0077, 0078). SECURITY DEFINER because skill_assessments and
-- skill_ratings carry an INSERT policy and a founder-only DELETE policy and no
-- UPDATE policy at all — a coach could not amend a rating even in principle, so
-- a mis-tapped score was permanent and the parent-facing mastery number stayed
-- wrong. Find-or-create keys on exactly the columns
-- skill_assessments_once_per_session indexes, so a second save edits the first
-- instead of failing 23505; ratings upsert, so a skill the coach did not touch
-- keeps its value. Ad-hoc assessments (p_session null) sit outside that partial
-- index and stay append-only — they are dated notes, not a record of one class.
--
-- skill_assessments_notify fires AFTER INSERT only, so an edit deliberately
-- does not re-announce itself in the founder's ops feed.
--
-- p_coach (0078) is who the assessment is credited to, defaulting to the caller.
-- It exists because the founder's "view as coach" preview is the only route to
-- correct a coach's paperwork — /admin has no assessment editor — and crediting
-- that correction to the founder both left the coach's wrong rating in place
-- (the sheet tests `alreadyFiled` as the previewed coach) and left the coach's
-- backlog un-cleared (both queue functions test `a.coach_id = p_coach`).
-- Passing a coach other than yourself is founder-only.
create or replace function public.save_session_assessment(
  p_player uuid,
  p_session uuid default null,
  p_ratings jsonb default '[]'::jsonb,
  p_coach uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_coach uuid := coalesce(p_coach, auth.uid());
  v_assessment uuid;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;
  if not (is_coach() or is_founder()) then
    raise exception 'not_authorised';
  end if;

  if v_coach <> v_actor and not is_founder() then
    raise exception 'not_authorised';
  end if;

  if p_session is not null and not exists (
    select 1 from class_sessions s
     where s.id = p_session
       and (s.coach_id = v_coach or is_founder())
  ) then
    raise exception 'not_your_session';
  end if;

  if p_session is not null then
    select id into v_assessment
      from skill_assessments
     where player_id = p_player
       and session_id = p_session
       and coach_id = v_coach;
  end if;

  if v_assessment is null then
    insert into skill_assessments (player_id, coach_id, session_id)
    values (p_player, v_coach, p_session)
    returning id into v_assessment;
  end if;

  insert into skill_ratings (assessment_id, skill_id, rating)
  select v_assessment,
         (r->>'skill_id')::uuid,
         (r->>'rating')::smallint
    from jsonb_array_elements(coalesce(p_ratings, '[]'::jsonb)) as r
   where (r->>'skill_id') is not null
     and (r->>'rating') ~ '^[1-5]$'
  on conflict (assessment_id, skill_id)
    do update set rating = excluded.rating;

  return v_assessment;
end;
$function$;

create or replace function public.prune_wa_inbound_seen()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.wa_inbound_seen where created_at < now() - interval '1 day';
$$;

-- Every write to a push_subscriptions row comes from a browser that is open
-- right now, so "when was this row last written" and "when was this device last
-- alive" are the same fact. Stamped here rather than by each caller, so a
-- caller that forgets the column can't make a row look fresher than it is.
create or replace function public.touch_push_subscription()
returns trigger
language plpgsql
as $$
begin
  new.last_seen_at := now();
  return new;
end;
$$;

-- ── View ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.coach_client_view AS
  SELECT id, full_name, avatar_url FROM profiles p;

CREATE VIEW public.latest_skill_ratings WITH (security_invoker='true') AS
  SELECT DISTINCT ON (a.player_id, r.skill_id)
         a.player_id, r.skill_id, r.rating, a.coach_id, a.created_at
    FROM skill_ratings r
    JOIN skill_assessments a ON a.id = r.assessment_id
   ORDER BY a.player_id, r.skill_id, a.created_at DESC;

-- ── Triggers ─────────────────────────────────────────────────────────────────
CREATE TRIGGER trg_private_class_details_after_delete AFTER DELETE ON public.private_class_details FOR EACH ROW EXECUTE FUNCTION _delete_class_on_private_details_delete();
CREATE TRIGGER profiles_grant_trial AFTER INSERT ON public.profiles FOR EACH ROW WHEN ((new.role = 'client'::user_role)) EXECUTE FUNCTION grant_signup_trial();
CREATE TRIGGER bookings_ops_feed_insert AFTER INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION ops_notify_booking_created();
CREATE TRIGGER bookings_ops_feed_status AFTER UPDATE OF status ON public.bookings FOR EACH ROW EXECUTE FUNCTION ops_notify_booking_status();
CREATE TRIGGER class_credits_ops_feed AFTER UPDATE ON public.class_credits FOR EACH ROW EXECUTE FUNCTION ops_notify_credit_used();
CREATE TRIGGER class_sessions_ops_feed AFTER UPDATE OF coach_id ON public.class_sessions FOR EACH ROW EXECUTE FUNCTION ops_notify_coach_change();
CREATE TRIGGER class_sessions_reset_confirmation BEFORE UPDATE OF coach_id, starts_at ON public.class_sessions FOR EACH ROW EXECUTE FUNCTION reset_session_confirmation();
CREATE TRIGGER notifications_name_the_session BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION notify_name_the_session();
CREATE TRIGGER classes_notify_open AFTER INSERT ON public.classes FOR EACH ROW EXECUTE FUNCTION ops_notify_class_open();
CREATE TRIGGER skill_assessments_notify AFTER INSERT ON public.skill_assessments FOR EACH ROW EXECUTE FUNCTION ops_notify_assessment();
CREATE TRIGGER student_notes_notify AFTER INSERT ON public.student_notes FOR EACH ROW EXECUTE FUNCTION ops_notify_student_note();
CREATE TRIGGER invoices_ops_feed AFTER INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION ops_notify_invoice();
CREATE TRIGGER orders_ops_feed AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION ops_notify_order_paid();
CREATE TRIGGER players_ops_feed AFTER INSERT ON public.players FOR EACH ROW EXECUTE FUNCTION ops_notify_new_player();
CREATE TRIGGER profiles_ops_feed AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION ops_notify_new_profile();
CREATE TRIGGER subscriptions_ops_feed AFTER INSERT OR UPDATE OF status ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION ops_notify_subscription();
CREATE TRIGGER profiles_claim_client_invite AFTER INSERT OR UPDATE OF phone ON public.profiles FOR EACH ROW WHEN ((new.phone IS NOT NULL)) EXECUTE FUNCTION claim_client_invite();
CREATE TRIGGER push_subscriptions_touch BEFORE INSERT OR UPDATE ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION touch_push_subscription();
CREATE TRIGGER class_sessions_resolve_alerts AFTER UPDATE OR DELETE ON public.class_sessions FOR EACH ROW EXECUTE FUNCTION _session_alert_resolve_trigger();

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.area_interest enable row level security;
alter table public.audit_log enable row level security;
alter table public.booking_series enable row level security;
alter table public.bookings enable row level security;
alter table public.class_credits enable row level security;
alter table public.class_sessions enable row level security;
alter table public.classes enable row level security;
alter table public.client_invites enable row level security;
alter table public.coach_assignments enable row level security;
alter table public.coach_invites enable row level security;
alter table public.coaches enable row level security;
alter table public.invoices enable row level security;
alter table public.notifications enable row level security;
alter table public.orders enable row level security;
alter table public.plans enable row level security;
alter table public.players enable row level security;
alter table public.products enable row level security;
alter table public.private_booking_series enable row level security;
alter table public.private_class_details enable row level security;
alter table public.private_credit_ledger enable row level security;
alter table public.profiles enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.school_admins enable row level security;
alter table public.settings enable row level security;
alter table public.skill_categories enable row level security;
alter table public.skills enable row level security;
alter table public.skill_assessments enable row level security;
alter table public.skill_ratings enable row level security;
alter table public.student_notes enable row level security;
alter table public.subscriptions enable row level security;
alter table public.venues enable row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_inbound_seen enable row level security;
alter table public.webhook_events enable row level security;

-- ── Policies ─────────────────────────────────────────────────────────────────
CREATE POLICY "anyone may leave area interest" ON public.area_interest AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "founder reads area interest" ON public.area_interest AS PERMISSIVE FOR SELECT TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "founder reads audit" ON public.audit_log AS PERMISSIVE FOR SELECT TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "founder writes audit" ON public.audit_log AS PERMISSIVE FOR INSERT TO public WITH CHECK (( SELECT is_founder() AS is_founder));
CREATE POLICY "clients read own series" ON public.booking_series AS PERMISSIVE FOR SELECT TO public USING ((client_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "coaches read series on their sessions" ON public.booking_series AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM class_sessions s WHERE ((s.class_id = booking_series.class_id) AND (s.coach_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "founder all series" ON public.booking_series AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "clients read own bookings" ON public.bookings AS PERMISSIVE FOR SELECT TO public USING ((client_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "coaches read their rosters" ON public.bookings AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM class_sessions s WHERE ((s.id = bookings.session_id) AND (s.coach_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "coaches write attendance" ON public.bookings AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1 FROM class_sessions s WHERE ((s.id = bookings.session_id) AND (s.coach_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "founder full access" ON public.bookings AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
-- School pupils carry client_id = null, so "clients read own bookings" matches
-- nothing for them and every attendance figure would read zero without this.
CREATE POLICY "school reads pupil bookings" ON public.bookings AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_school_admin() AS is_school_admin) AND school_has_player(player_id)));
CREATE POLICY "own credits" ON public.class_credits AS PERMISSIVE FOR SELECT TO public USING (((client_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder writes credits" ON public.class_credits AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "coach updates own session notes" ON public.class_sessions AS PERMISSIVE FOR UPDATE TO public USING ((coach_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "founder writes sessions" ON public.class_sessions AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "read scheduled sessions" ON public.class_sessions AS PERMISSIVE FOR SELECT TO public USING ((class_is_public_group(class_id) OR (coach_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder) OR client_owns_private_class(class_id)));
CREATE POLICY "school reads pupil sessions" ON public.class_sessions AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_school_admin() AS is_school_admin) AND school_admin_session(id)));
CREATE POLICY "founder writes classes" ON public.classes AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "public reads active group classes" ON public.classes AS PERMISSIVE FOR SELECT TO public USING ((((active = true) AND (class_type = 'group'::class_type) AND (is_school = false)) OR ( SELECT is_founder() AS is_founder) OR (( SELECT is_coach() AS is_coach) AND coach_teaches_class(id)) OR client_owns_private_class(id)));
-- getStudentInsights joins classes(title, class_type) off the session.
CREATE POLICY "school reads pupil classes" ON public.classes AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_school_admin() AS is_school_admin) AND school_admin_class(id)));
CREATE POLICY "founder all client invites" ON public.client_invites AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "assignments visible" ON public.coach_assignments AS PERMISSIVE FOR SELECT TO public USING (((coach_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder writes assignments" ON public.coach_assignments AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "coach writes own row" ON public.coaches AS PERMISSIVE FOR UPDATE TO public USING ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "founder all coaches" ON public.coaches AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "founder all coach invites" ON public.coach_invites AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "public reads active coaches" ON public.coaches AS PERMISSIVE FOR SELECT TO public USING (((active = true) OR (id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "own invoices" ON public.invoices AS PERMISSIVE FOR SELECT TO public USING (((client_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder reads notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "founder writes notifications" ON public.notifications AS PERMISSIVE FOR INSERT TO public WITH CHECK (( SELECT is_founder() AS is_founder));
CREATE POLICY "mark own notifications read" ON public.notifications AS PERMISSIVE FOR UPDATE TO public USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO public USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "own orders" ON public.orders AS PERMISSIVE FOR SELECT TO public USING (((client_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder writes orders" ON public.orders AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "anyone reads active plans" ON public.plans AS PERMISSIVE FOR SELECT TO public USING (((active = true) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder writes plans" ON public.plans AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "anyone reads active products" ON public.products AS PERMISSIVE FOR SELECT TO public USING (((active = true) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder writes products" ON public.products AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "coach reads own rosters players" ON public.players AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_coach() AS is_coach) AND coach_has_player(id)));
CREATE POLICY "coach reads school pupils" ON public.players AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_coach() AS is_coach) AND coach_teaches_school_of(id)));
CREATE POLICY "founder all players" ON public.players AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "own household" ON public.players AS PERMISSIVE FOR ALL TO public USING ((client_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((client_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "school reads own pupils" ON public.players AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_school_admin() AS is_school_admin) AND school_has_player(id)));
CREATE POLICY "clients read own private series" ON public.private_booking_series AS PERMISSIVE FOR SELECT TO public USING ((client_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "founder all private series" ON public.private_booking_series AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "founder writes private details" ON public.private_class_details AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "private details visible to owner coach founder" ON public.private_class_details AS PERMISSIVE FOR SELECT TO public USING (((client_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder) OR coach_teaches_class(class_id)));
CREATE POLICY "founder writes ledger" ON public.private_credit_ledger AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "own ledger" ON public.private_credit_ledger AS PERMISSIVE FOR SELECT TO public USING (((client_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder all profiles" ON public.profiles AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "own profile" ON public.profiles AS PERMISSIVE FOR ALL TO public USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "own push subscriptions" ON public.push_subscriptions AS PERMISSIVE FOR ALL TO public USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "authenticated read settings" ON public.settings AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.uid() AS uid) IS NOT NULL));
CREATE POLICY "founder writes settings" ON public.settings AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "coach or founder reads notes" ON public.student_notes AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_coach() AS is_coach) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "coach or founder writes notes" ON public.student_notes AS PERMISSIVE FOR INSERT TO public WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND (( SELECT is_coach() AS is_coach) OR ( SELECT is_founder() AS is_founder))));
CREATE POLICY "author or founder deletes note" ON public.student_notes AS PERMISSIVE FOR DELETE TO public USING (((author_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder writes subscriptions" ON public.subscriptions AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "own subscriptions" ON public.subscriptions AS PERMISSIVE FOR SELECT TO public USING (((client_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder all school admins" ON public.school_admins AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "school reads own link" ON public.school_admins AS PERMISSIVE FOR SELECT TO public USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "founder writes venues" ON public.venues AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "public reads active venues" ON public.venues AS PERMISSIVE FOR SELECT TO public USING (((active = true) OR ( SELECT is_founder() AS is_founder)));
-- There is no wa_* policy, and that absence is deliberate. The one that existed
-- read wa_links, which 0074 dropped: profiles.phone is the binding now, and it
-- is covered by the profiles policies. wa_messages and wa_inbound_seen keep RLS
-- on with no policy at all — service-role only, so the chat transcript stays
-- out of the chat's own reach.
CREATE POLICY "founder reads webhook events" ON public.webhook_events AS PERMISSIVE FOR SELECT TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "staff reads categories" ON public.skill_categories AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_coach() AS is_coach) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder manages categories" ON public.skill_categories AS PERMISSIVE FOR ALL TO public USING (( SELECT is_founder() AS is_founder)) WITH CHECK (( SELECT is_founder() AS is_founder));
CREATE POLICY "staff reads skills" ON public.skills AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_coach() AS is_coach) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "staff adds skills" ON public.skills AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT is_coach() AS is_coach) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "staff updates skills" ON public.skills AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT is_coach() AS is_coach) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "founder deletes skills" ON public.skills AS PERMISSIVE FOR DELETE TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "staff reads assessments" ON public.skill_assessments AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_coach() AS is_coach) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "author writes assessments" ON public.skill_assessments AS PERMISSIVE FOR INSERT TO public WITH CHECK (((coach_id = ( SELECT auth.uid() AS uid)) AND (( SELECT is_coach() AS is_coach) OR ( SELECT is_founder() AS is_founder))));
CREATE POLICY "founder deletes assessments" ON public.skill_assessments AS PERMISSIVE FOR DELETE TO public USING (( SELECT is_founder() AS is_founder));
CREATE POLICY "staff reads ratings" ON public.skill_ratings AS PERMISSIVE FOR SELECT TO public USING ((( SELECT is_coach() AS is_coach) OR ( SELECT is_founder() AS is_founder)));
CREATE POLICY "author writes ratings" ON public.skill_ratings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1 FROM skill_assessments a WHERE ((a.id = skill_ratings.assessment_id) AND (a.coach_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "founder deletes ratings" ON public.skill_ratings AS PERMISSIVE FOR DELETE TO public USING (( SELECT is_founder() AS is_founder));
