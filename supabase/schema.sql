-- Sharwin Academy — canonical public schema.
--
-- GENERATED from the live database via the Supabase MCP server. Do not edit by
-- hand. Regenerate after any schema change (see AGENTS.md -> Database).
--
-- This is a reference dump, grouped for readability (extensions, enums, tables,
-- constraints, indexes, functions, view, RLS). It is not guaranteed to run
-- top-to-bottom (e.g. functions are ordered alphabetically, not by dependency).
-- Source of truth for column names, types, enum values, constraints and RLS.

set search_path = public;

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists btree_gist;     -- coach_no_overlap exclusion

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
create type public.skill_level as enum ('beginner', 'intermediate', 'advanced', 'elite');
create type public.subscription_source as enum ('stripe', 'comp', 'razorpay');
create type public.subscription_status as enum ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'paused');
create type public.time_off_status as enum ('pending', 'approved', 'rejected');
create type public.user_role as enum ('client', 'coach', 'founder');

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
  client_id uuid not null,
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
  client_id uuid not null,
  player_id uuid not null,
  status booking_status default 'confirmed'::booking_status not null,
  waitlist_position integer,
  rescheduled_from uuid,
  coach_note text,
  booked_at timestamptz default now() not null,
  cancelled_at timestamptz,
  cancel_reason text,
  series_id uuid
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
  coach_arrived_at timestamptz
);

create table public.classes (
  id uuid default gen_random_uuid() not null,
  class_type class_type not null,
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

create table public.coach_availability (
  id uuid default gen_random_uuid() not null,
  coach_id uuid not null,
  weekday smallint not null,
  start_time time not null,
  end_time time not null
);

create table public.coach_time_off (
  id uuid default gen_random_uuid() not null,
  coach_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  status time_off_status default 'pending'::time_off_status not null,
  decided_by uuid,
  created_at timestamptz default now() not null
);

create table public.coaches (
  id uuid not null,
  bio text,
  base_lat float8 not null,
  base_lng float8 not null,
  travel_radius_km numeric(5,1) default 10 not null,
  base_address text,
  max_teachable_level skill_level default 'advanced'::skill_level not null,
  dbs_checked boolean default false not null,
  tier smallint default 1 not null,
  active boolean default true not null,
  created_at timestamptz default now() not null
);

create table public.coach_invites (
  id uuid default gen_random_uuid() not null,
  email text not null,
  full_name text,
  phone text,
  bio text,
  tier smallint default 1 not null,
  max_teachable_level skill_level default 'advanced'::skill_level not null,
  travel_radius_km numeric(5,1) default 10 not null,
  dbs_checked boolean default false not null,
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
  created_at timestamptz default now() not null
);

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
  active boolean default true not null,
  created_at timestamptz default now() not null,
  razorpay_plan_id text
);

create table public.players (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  full_name text not null,
  date_of_birth date,
  skill_level skill_level default 'beginner'::skill_level not null,
  notes text,
  created_at timestamptz default now() not null
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

create table public.private_class_details (
  class_id uuid not null,
  client_id uuid not null,
  player_id uuid not null,
  address text not null,
  postcode text not null,
  lat float8 not null,
  lng float8 not null,
  has_table boolean default true not null,
  access_notes text,
  address_details jsonb
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
  razorpay_customer_id text
);

create table public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now() not null
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

create table public.venues (
  id uuid default gen_random_uuid() not null,
  name text not null,
  address text not null,
  postcode text not null,
  lat float8 not null,
  lng float8 not null,
  notes text,
  photo_url text,
  address_details jsonb,
  active boolean default true not null,
  created_at timestamptz default now() not null
);

create table public.wa_link_codes (
  code text not null,
  user_id uuid not null,
  created_at timestamptz default now() not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table public.wa_links (
  phone text not null,
  user_id uuid not null,
  linked_at timestamptz default now() not null
);

create table public.wa_messages (
  id uuid default gen_random_uuid() not null,
  phone text not null,
  role text not null,
  content text not null,
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
ALTER TABLE public.class_sessions ADD CONSTRAINT session_window CHECK ((starts_at < ends_at));
ALTER TABLE public.classes ADD CONSTRAINT classes_pkey PRIMARY KEY (id);
ALTER TABLE public.classes ADD CONSTRAINT classes_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.classes ADD CONSTRAINT classes_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES venues(id);
ALTER TABLE public.classes ADD CONSTRAINT classes_capacity_check CHECK ((capacity >= 1));
ALTER TABLE public.classes ADD CONSTRAINT classes_duration_minutes_check CHECK (((duration_minutes >= 30) AND (duration_minutes <= 240)));
ALTER TABLE public.classes ADD CONSTRAINT group_needs_venue CHECK (((class_type <> 'group'::class_type) OR (venue_id IS NOT NULL)));
ALTER TABLE public.coach_assignments ADD CONSTRAINT coach_assignments_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_assignments ADD CONSTRAINT coach_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.coach_assignments ADD CONSTRAINT coach_assignments_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE;
ALTER TABLE public.coach_assignments ADD CONSTRAINT coach_assignments_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.coach_availability ADD CONSTRAINT coach_availability_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_availability ADD CONSTRAINT coach_availability_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE;
ALTER TABLE public.coach_availability ADD CONSTRAINT availability_window CHECK ((start_time < end_time));
ALTER TABLE public.coach_availability ADD CONSTRAINT coach_availability_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)));
ALTER TABLE public.coach_time_off ADD CONSTRAINT coach_time_off_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_time_off ADD CONSTRAINT coach_time_off_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE;
ALTER TABLE public.coach_time_off ADD CONSTRAINT coach_time_off_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.coach_time_off ADD CONSTRAINT time_off_window CHECK ((starts_at < ends_at));
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
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.student_notes ADD CONSTRAINT student_notes_pkey PRIMARY KEY (id);
ALTER TABLE public.student_notes ADD CONSTRAINT student_notes_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.student_notes ADD CONSTRAINT student_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id);
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
ALTER TABLE public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE public.products ADD CONSTRAINT products_price_pence_check CHECK ((price_pence >= 0));
ALTER TABLE public.products ADD CONSTRAINT products_member_price_pence_check CHECK ((member_price_pence >= 0));
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
ALTER TABLE public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (key);
ALTER TABLE public.settings ADD CONSTRAINT settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_razorpay_subscription_id_key UNIQUE (razorpay_subscription_id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_client_id_fkey FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans(id);
ALTER TABLE public.venues ADD CONSTRAINT venues_pkey PRIMARY KEY (id);
ALTER TABLE public.wa_link_codes ADD CONSTRAINT wa_link_codes_pkey PRIMARY KEY (code);
ALTER TABLE public.wa_link_codes ADD CONSTRAINT wa_link_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.wa_links ADD CONSTRAINT wa_links_user_id_key UNIQUE (user_id);
ALTER TABLE public.wa_links ADD CONSTRAINT wa_links_pkey PRIMARY KEY (phone);
ALTER TABLE public.wa_links ADD CONSTRAINT wa_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.wa_messages ADD CONSTRAINT wa_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.wa_messages ADD CONSTRAINT wa_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_event_id_key UNIQUE (event_id);
ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_stripe_event_id_key UNIQUE (stripe_event_id);
ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);

-- ── Indexes (non-constraint) ─────────────────────────────────────────────────
CREATE INDEX audit_log_entity_entity_id_idx ON public.audit_log USING btree (entity, entity_id);
CREATE INDEX booking_series_active_class ON public.booking_series USING btree (class_id) WHERE active;
CREATE UNIQUE INDEX booking_series_one_active ON public.booking_series USING btree (player_id, class_id, weekday, start_time) WHERE active;
CREATE INDEX bookings_client_id_status_idx ON public.bookings USING btree (client_id, status);
CREATE UNIQUE INDEX bookings_one_live_per_player ON public.bookings USING btree (session_id, player_id) WHERE (status = ANY (ARRAY['confirmed'::booking_status, 'waitlisted'::booking_status, 'attended'::booking_status, 'no_show'::booking_status]));
CREATE INDEX bookings_series_id ON public.bookings USING btree (series_id) WHERE (series_id IS NOT NULL);
CREATE INDEX bookings_session_id_idx ON public.bookings USING btree (session_id) WHERE (status = 'waitlisted'::booking_status);
CREATE INDEX class_credits_client_open_idx ON public.class_credits USING btree (client_id) WHERE (consumed_at IS NULL);
CREATE UNIQUE INDEX class_credits_one_trial_per_player ON public.class_credits USING btree (player_id) WHERE (type = 'group_trial'::class_credit_type);
CREATE INDEX class_sessions_class_id_starts_at_idx ON public.class_sessions USING btree (class_id, starts_at);
CREATE INDEX class_sessions_coach_id_starts_at_idx ON public.class_sessions USING btree (coach_id, starts_at) WHERE (status = 'scheduled'::session_status);
CREATE INDEX class_sessions_starts_at_idx ON public.class_sessions USING btree (starts_at) WHERE (coach_id IS NULL);
CREATE INDEX classes_class_type_active_idx ON public.classes USING btree (class_type, active);
CREATE INDEX classes_venue_id_idx ON public.classes USING btree (venue_id) WHERE (venue_id IS NOT NULL);
CREATE INDEX coach_assignments_session_id_status_idx ON public.coach_assignments USING btree (session_id, status);
CREATE INDEX coach_availability_coach_id_weekday_idx ON public.coach_availability USING btree (coach_id, weekday);
CREATE INDEX coach_time_off_coach_id_starts_at_idx ON public.coach_time_off USING btree (coach_id, starts_at);
CREATE INDEX coach_invites_phone_idx ON public.coach_invites USING btree (phone) WHERE (phone IS NOT NULL);
CREATE UNIQUE INDEX invoices_razorpay_payment_id_key ON public.invoices USING btree (razorpay_payment_id) WHERE (razorpay_payment_id IS NOT NULL);
CREATE INDEX notifications_status_scheduled_for_idx ON public.notifications USING btree (status, scheduled_for);
CREATE INDEX student_notes_player_created_idx ON public.student_notes USING btree (player_id, created_at DESC);
CREATE INDEX players_client_id_idx ON public.players USING btree (client_id);
CREATE INDEX private_credit_ledger_client_id_idx ON public.private_credit_ledger USING btree (client_id);
CREATE INDEX subscriptions_client_id_status_idx ON public.subscriptions USING btree (client_id, status);
CREATE INDEX wa_link_codes_user_idx ON public.wa_link_codes USING btree (user_id);
CREATE INDEX wa_messages_phone_idx ON public.wa_messages USING btree (phone, created_at DESC);

-- ── Functions ────────────────────────────────────────────────────────────────

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
      -- reminders always (each fires at its own session time)
      insert into notifications (user_id, type, title, body, data, scheduled_for) values
        (p_client, 'reminder_24h', 'Tomorrow', v_class.title,
         jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
         v_session.starts_at - interval '24 hours'),
        (p_client, 'reminder_2h', 'Later today', v_class.title,
         jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
         v_session.starts_at - interval '2 hours');
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
  -- Consume one open class credit for a group booking: the player's free trial
  -- first, then any drop-in. Raises no_entitlement when nothing is available.
  select id into v_id
  from class_credits
  where client_id = p_client and consumed_at is null
    and (
      (type = 'group_trial' and player_id = p_player)
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
    insert into notifications (user_id, type, title, body, data)
    select p.id, 'session_unassigned', 'Session needs a coach',
           'No coach fits this slot — resolve it in the calendar.',
           jsonb_build_object('session_id', p_session, 'url', '/admin/calendar')
    from profiles p where p.role = 'founder';
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

    -- confirmation + reminders (P11 delivers)
    insert into notifications (user_id, type, title, body, data, scheduled_for) values
      (v_client, 'booking_confirmed', 'Booked.',
       to_char(v_session.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI am') || ' — ' || v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
       now()),
      (v_client, 'reminder_24h', 'Tomorrow', v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
       v_session.starts_at - interval '24 hours'),
      (v_client, 'reminder_2h', 'Later today', v_class.title,
       jsonb_build_object('booking_id', v_booking.id, 'session_id', p_session, 'url', '/app/schedule'),
       v_session.starts_at - interval '2 hours');
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

  -- Group credit (trial / drop-in): hand it back when cancelled in-window.
  if v_free then
    update class_credits
    set consumed_at = null, booking_id = null
    where booking_id = p_booking;
  end if;

  -- Offer-based waitlist promotion (A3): notify position 1, don't auto-confirm.
  if v_booking.status = 'confirmed' then
    select * into v_next
    from bookings
    where session_id = v_booking.session_id and status = 'waitlisted'
    order by waitlist_position asc limit 1;

    if found then
      insert into notifications (user_id, type, title, body, data, scheduled_for)
      values (v_next.client_id, 'waitlist_spot', 'A spot opened',
        'Claim it within ' || get_setting_int('waitlist_claim_minutes', 15) || ' minutes.',
        jsonb_build_object('booking_id', v_next.id, 'session_id', v_booking.session_id,
                           'claim_by', now() + make_interval(mins => get_setting_int('waitlist_claim_minutes', 15)),
                           'url', '/app/book/class/' || v_booking.session_id),
        now());
    end if;
  end if;

  -- Sweep pending reminders for this booking (P11 hygiene, done inline here)
  delete from notifications
  where status = 'pending'
    and (data->>'booking_id')::uuid = p_booking
    and type in ('reminder_24h', 'reminder_2h');
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
        'url', '/app/book/class/' || r.session_id), now()
    from bookings b
    where b.session_id = r.session_id and b.status = 'waitlisted'
    order by b.waitlist_position asc limit 1;

    delete from notifications where status = 'pending'
      and (data->>'booking_id')::uuid = r.id
      and type in ('reminder_24h','reminder_2h');
  end loop;

  update booking_series set active = false, cancelled_at = now() where id = p_series;
  return v_count;
end;
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
  v_lat float8; v_lng float8;
  v_buffer int := get_setting_int('travel_buffer_minutes', 30);
  v_wd smallint;
  v_start time; v_end time;
  v_has_junior boolean;
begin
  select * into v_coach from coaches where id = p_coach and active;
  if not found then return 'inactive'; end if;

  select * into v_session from class_sessions where id = p_session;
  select * into v_class from classes where id = v_session.class_id;

  -- 1. time off
  if exists (
    select 1 from coach_time_off t
    where t.coach_id = p_coach and t.status = 'approved'
      and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then return 'time_off'; end if;

  -- 2. availability window (Asia/Kolkata wall clock, weekday 0=Mon)
  v_wd := ((extract(isodow from v_session.starts_at at time zone 'Asia/Kolkata'))::int - 1);
  v_start := (v_session.starts_at at time zone 'Asia/Kolkata')::time;
  v_end := (v_session.ends_at at time zone 'Asia/Kolkata')::time;
  if not exists (
    select 1 from coach_availability a
    where a.coach_id = p_coach and a.weekday = v_wd
      and a.start_time <= v_start and a.end_time >= v_end
  ) then return 'unavailable'; end if;

  -- 3. overlap incl. travel buffer at different locations
  if exists (
    select 1 from class_sessions s2
    join classes c2 on c2.id = s2.class_id
    where s2.coach_id = p_coach and s2.status = 'scheduled' and s2.id <> p_session
      and tstzrange(
            s2.starts_at - case when c2.venue_id is distinct from v_class.venue_id
                                then make_interval(mins => v_buffer) else interval '0' end,
            s2.ends_at + case when c2.venue_id is distinct from v_class.venue_id
                              then make_interval(mins => v_buffer) else interval '0' end
          ) && tstzrange(v_session.starts_at, v_session.ends_at)
  ) then return 'overlap'; end if;

  -- 4. radius for private sessions
  if v_class.class_type = 'private' then
    select d.lat, d.lng into v_lat, v_lng
    from private_class_details d where d.class_id = v_class.id;
    if haversine_km(v_lat, v_lng, v_coach.base_lat, v_coach.base_lng) > v_coach.travel_radius_km then
      return 'out_of_radius';
    end if;
  end if;

  -- 5. level ceiling
  if v_class.skill_level > v_coach.max_teachable_level then
    return 'level_too_high';
  end if;

  -- 6. safeguarding: junior in the room requires DBS
  select exists (
    select 1 from bookings b
    join players pl on pl.id = b.player_id
    where b.session_id = p_session
      and b.status in ('confirmed', 'waitlisted')
      and pl.date_of_birth is not null
      and pl.date_of_birth > (current_date - interval '18 years')
    union
    select 1 from private_class_details d
    join players pl on pl.id = d.player_id
    where d.class_id = v_class.id
      and pl.date_of_birth is not null
      and pl.date_of_birth > (current_date - interval '18 years')
  ) into v_has_junior;
  if v_has_junior and not v_coach.dbs_checked then
    return 'dbs_required';
  end if;

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

CREATE OR REPLACE FUNCTION public.founder_reassign(p_session uuid, p_coach uuid, p_lock boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fail text;
  v_old uuid;
begin
  if not is_founder() then raise exception 'founder_only'; end if;

  v_fail := coach_filter_failure(p_coach, p_session);
  if v_fail is not null then
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
          jsonb_build_object('from', v_old, 'to', p_coach, 'locked', p_lock));

  -- notify old coach, new coach, booked clients
  if v_old is not null and v_old <> p_coach then
    insert into notifications (user_id, type, title, body, data)
    values (v_old, 'coach_changed', 'Session reassigned',
            'One of your sessions was moved to another coach.',
            jsonb_build_object('session_id', p_session, 'url', '/coach/calendar'));
  end if;

  insert into notifications (user_id, type, title, body, data)
  values (p_coach, 'coach_changed', 'New session assigned',
          'A session was added to your calendar.',
          jsonb_build_object('session_id', p_session, 'url', '/coach/calendar'));

  insert into notifications (user_id, type, title, body, data)
  select distinct b.client_id, 'coach_changed', 'Meet your new coach',
         'Your session has a new coach — say hello at the table.',
         jsonb_build_object('session_id', p_session, 'url', '/app/schedule')
  from bookings b
  where b.session_id = p_session and b.status = 'confirmed';
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

CREATE OR REPLACE FUNCTION public.get_bookable_slots(p_lat double precision, p_lng double precision, p_duration integer, p_player uuid, p_days integer DEFAULT 14)
 RETURNS TABLE(starts_at timestamp with time zone, coach_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_junior boolean;
begin
  select pl.date_of_birth is not null
     and pl.date_of_birth > (current_date - interval '18 years')
  into v_is_junior
  from players pl where pl.id = p_player;

  return query
  with candidate_coaches as (
    select c.* from coaches c
    where c.active
      and haversine_km(p_lat, p_lng, c.base_lat, c.base_lng) <= c.travel_radius_km
      and (not coalesce(v_is_junior, false) or c.dbs_checked)
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
    -- availability window
    exists (
      select 1 from coach_availability a
      where a.coach_id = c.id
        and a.weekday = ((extract(isodow from s.slot_start at time zone 'Asia/Kolkata'))::int - 1)
        and a.start_time <= (s.slot_start at time zone 'Asia/Kolkata')::time
        and a.end_time >= ((s.slot_start + make_interval(mins => p_duration)) at time zone 'Asia/Kolkata')::time
    )
    -- no approved time off
    and not exists (
      select 1 from coach_time_off t
      where t.coach_id = c.id and t.status = 'approved'
        and tstzrange(t.starts_at, t.ends_at)
          && tstzrange(s.slot_start, s.slot_start + make_interval(mins => p_duration))
    )
    -- no overlapping scheduled session (+ buffer, conservatively applied)
    and not exists (
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

CREATE OR REPLACE FUNCTION public.handle_coach_dropout(p_coach uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
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

      insert into notifications (user_id, type, title, body, data)
      values (v_new, 'coach_changed', 'You picked up a session',
              'Cover assigned to you automatically.',
              jsonb_build_object('session_id', r.id, 'url', '/coach/calendar'));

      insert into notifications (user_id, type, title, body, data)
      select distinct b.client_id, 'coach_changed', 'Meet your new coach',
             'Your session has a new coach.',
             jsonb_build_object('session_id', r.id, 'url', '/app/schedule')
      from bookings b where b.session_id = r.id and b.status = 'confirmed';
    else
      insert into notifications (user_id, type, title, body, data)
      select p.id, 'session_unassigned', 'Cover needed',
             'A coach dropped a session and no substitute fits.',
             jsonb_build_object('session_id', r.id, 'url', '/admin/calendar')
      from profiles p where p.role = 'founder';
      -- clients are NOT notified — founder decides the outcome
    end if;

    insert into audit_log (actor_id, action, entity, entity_id, meta)
    values (auth.uid(), 'session.dropout_cascade', 'class_sessions', r.id,
            jsonb_build_object('dropped_coach', p_coach, 'replacement', v_new));
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.grant_signup_trial()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Free trial: every new player gets one group-class credit, once, forever.
  -- Fired by the players_grant_trial trigger (see Triggers below).
  insert into class_credits (client_id, player_id, type, source, note)
  values (new.client_id, new.id, 'group_trial', 'signup', 'Free trial class')
  on conflict (player_id) where (type = 'group_trial') do nothing;
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
    '{"continuity":35,"proximity":25,"load":20,"adjacency":15,"seniority":5}'::jsonb
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
      ))::int as adjacency,
      c.tier
    from pool c
  ),
  norm as (
    select *,
      case when max(dist) over () = min(dist) over () then 1.0
           else 1.0 - (dist - min(dist) over ()) / nullif(max(dist) over () - min(dist) over (), 0) end as proximity_n,
      case when max(load_hours) over () = min(load_hours) over () then 1.0
           else 1.0 - (load_hours - min(load_hours) over ()) / nullif(max(load_hours) over () - min(load_hours) over (), 0) end as load_n,
      case when max(tier) over () = min(tier) over () then 1.0
           else (tier - min(tier) over ())::numeric / nullif(max(tier) over () - min(tier) over (), 0) end as seniority_n
    from metrics
  )
  select
    n.id,
    round((
      (v_weights->>'continuity')::numeric * n.continuity
      + (v_weights->>'proximity')::numeric * n.proximity_n
      + (v_weights->>'load')::numeric * n.load_n
      + (v_weights->>'adjacency')::numeric * n.adjacency
      + (v_weights->>'seniority')::numeric * n.seniority_n
      + case when p_preferred is not null and n.id = p_preferred then 40 else 0 end
    )::numeric, 2) as score
  from norm n
  order by score desc, n.load_hours asc, n.tier desc, n.id asc;
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
  v_class_id uuid;
  v_session_id uuid;
  v_booking bookings%rowtype;
  v_coach uuid;
  v_balance int;
begin
  if v_client is null then raise exception 'not_authenticated'; end if;

  -- Minutes are the entitlement: they arrive from a private plan's monthly
  -- grant or a one-off purchase. No subscription requirement.
  v_balance := private_minutes_balance(v_client);
  if v_balance < v_duration then raise exception 'insufficient_minutes'; end if;

  if not exists (select 1 from players where id = v_player and client_id = v_client) then
    raise exception 'player_not_in_household';
  end if;

  if v_start < now() + interval '24 hours' then
    raise exception 'lead_time_24h';
  end if;

  insert into classes (class_type, title, skill_level, capacity, duration_minutes, starts_on, created_by)
  values ('private', 'Private session', 'beginner', 1, v_duration, (v_start at time zone 'Asia/Kolkata')::date, v_client)
  returning id into v_class_id;

  insert into private_class_details (class_id, client_id, player_id, address, postcode, lat, lng, has_table, access_notes, address_details)
  values (
    v_class_id, v_client, v_player,
    payload->>'address', coalesce(payload->>'postcode', ''),
    (payload->>'lat')::float8, (payload->>'lng')::float8,
    coalesce((payload->>'has_table')::boolean, true),
    payload->>'access_notes',
    payload->'address_details'
  );

  insert into class_sessions (class_id, starts_at, ends_at)
  values (v_class_id, v_start, v_start + make_interval(mins => v_duration))
  returning id into v_session_id;

  v_coach := assign_coach(v_session_id, v_preferred);

  -- Debit stands even if parked (refund only if founder cancels).
  insert into private_credit_ledger (client_id, delta_minutes, reason)
  values (v_client, -v_duration, 'booking');

  insert into bookings (session_id, client_id, player_id, status)
  values (v_session_id, v_client, v_player, 'confirmed')
  returning * into v_booking;

  if v_coach is not null then
    insert into notifications (user_id, type, title, body, data) values
      (v_client, 'coach_assigned', 'You''re on.',
       'Coach confirmed for ' || to_char(v_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am') || '.',
       jsonb_build_object('session_id', v_session_id, 'coach_id', v_coach, 'url', '/app/schedule')),
      (v_coach, 'new_private_session', 'New private session',
       to_char(v_start at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am') || ' — ' || (payload->>'address'),
       jsonb_build_object('session_id', v_session_id, 'url', '/coach/session/' || v_session_id));
  else
    insert into notifications (user_id, type, title, body, data)
    select p.id, 'private_request_parked', 'Private request parked',
           'A private request has no available coach — resolve manually.',
           jsonb_build_object('session_id', v_session_id, 'url', '/admin/calendar')
    from profiles p where p.role = 'founder';

    insert into notifications (user_id, type, title, body, data)
    values (v_client, 'coach_assigned', 'We''re confirming your coach',
            'You''ll hear from us within 24 hours.',
            jsonb_build_object('session_id', v_session_id, 'url', '/app/schedule'));
  end if;

  return v_session_id;
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
         jsonb_build_object('booking_id', b.id, 'session_id', v_booking.session_id), now()
  from bookings b
  where b.session_id = v_booking.session_id and b.status = 'waitlisted'
  order by b.waitlist_position asc limit 1;

  insert into notifications (user_id, type, title, body, data) values
    (v_client, 'booking_rescheduled', 'Rescheduled.',
     to_char(v_target.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon FMHH12:MI am'),
     jsonb_build_object('booking_id', v_new.id, 'url', '/app/schedule'));

  -- fresh reminders; sweep old ones
  delete from notifications where status = 'pending'
    and (data->>'booking_id')::uuid = p_booking
    and type in ('reminder_24h', 'reminder_2h');
  insert into notifications (user_id, type, title, body, data, scheduled_for) values
    (v_client, 'reminder_24h', 'Tomorrow', v_target_class.title,
     jsonb_build_object('booking_id', v_new.id, 'url', '/app/schedule'),
     v_target.starts_at - interval '24 hours'),
    (v_client, 'reminder_2h', 'Later today', v_target_class.title,
     jsonb_build_object('booking_id', v_new.id, 'url', '/app/schedule'),
     v_target.starts_at - interval '2 hours');

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
      select 1 from coach_time_off t
      where t.coach_id = v_old_coach and t.status = 'approved'
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_new_start, v_new_end)
    ) then v_fail := 'time_off'; end if;
    if v_fail is null and not exists (
      select 1 from coach_availability a
      where a.coach_id = v_old_coach
        and a.weekday = ((extract(isodow from p_new_start at time zone 'Asia/Kolkata'))::int - 1)
        and a.start_time <= (p_new_start at time zone 'Asia/Kolkata')::time
        and a.end_time >= (v_new_end at time zone 'Asia/Kolkata')::time
    ) then v_fail := 'unavailable'; end if;
    if v_fail is null and exists (
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

CREATE OR REPLACE FUNCTION public.sweep_session_status()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update class_sessions set status = 'completed'
  where status = 'scheduled' and ends_at < now();
  -- un-marked attendance defaults to attended after 48h
  update bookings b set status = 'attended'
  from class_sessions s
  where b.session_id = s.id and b.status = 'confirmed'
    and s.ends_at < now() - interval '48 hours';
$function$;

CREATE OR REPLACE FUNCTION public.coach_mark_arrival(p_session uuid, p_late boolean DEFAULT false)
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

  select coalesce(v.name, pcd.address, 'the venue')
    into v_location
    from classes c
    left join venues v on v.id = c.venue_id
    left join private_class_details pcd on pcd.class_id = c.id
    where c.id = v_class
    limit 1;

  v_time := to_char(v_starts at time zone 'Asia/Kolkata', 'FMHH12:MI AM');

  if p_late then
    v_type  := 'coach_late';
    v_title := 'Coach running late';
    v_body  := 'Coach ' || v_name || ' is running a few minutes late for the '
               || v_time || ' session.';
  else
    update class_sessions
       set coach_arrived_at = coalesce(coach_arrived_at, now())
     where id = p_session
     returning coach_arrived_at into v_arrived;
    v_type  := 'coach_arrived';
    v_title := 'Coach has arrived';
    v_body  := 'Coach ' || v_name || ' is at ' || v_location
               || ' for the ' || v_time || ' session.';
  end if;

  insert into notifications (user_id, type, title, body, data)
  select distinct b.client_id, v_type, v_title, v_body,
         jsonb_build_object('session_id', p_session, 'url', '/app')
    from bookings b
   where b.session_id = p_session
     and b.status in ('confirmed', 'attended');

  insert into notifications (user_id, type, title, body, data)
  select p.id, v_type, v_title, v_body,
         jsonb_build_object('session_id', p_session, 'url', '/admin/calendar')
    from profiles p where p.role = 'founder';

  return v_arrived;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_player_notes(p_player uuid)
 RETURNS TABLE(id uuid, body text, created_at timestamptz, author_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (is_coach() or is_founder()) then
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

-- ── View ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.coach_client_view AS
  SELECT id, full_name, avatar_url FROM profiles p;

-- ── Triggers ─────────────────────────────────────────────────────────────────
CREATE TRIGGER players_grant_trial AFTER INSERT ON public.players FOR EACH ROW EXECUTE FUNCTION grant_signup_trial();

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.area_interest enable row level security;
alter table public.audit_log enable row level security;
alter table public.booking_series enable row level security;
alter table public.bookings enable row level security;
alter table public.class_credits enable row level security;
alter table public.class_sessions enable row level security;
alter table public.classes enable row level security;
alter table public.coach_assignments enable row level security;
alter table public.coach_availability enable row level security;
alter table public.coach_time_off enable row level security;
alter table public.coach_invites enable row level security;
alter table public.coaches enable row level security;
alter table public.invoices enable row level security;
alter table public.notifications enable row level security;
alter table public.orders enable row level security;
alter table public.plans enable row level security;
alter table public.players enable row level security;
alter table public.products enable row level security;
alter table public.private_class_details enable row level security;
alter table public.private_credit_ledger enable row level security;
alter table public.profiles enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.settings enable row level security;
alter table public.student_notes enable row level security;
alter table public.subscriptions enable row level security;
alter table public.venues enable row level security;
alter table public.wa_link_codes enable row level security;
alter table public.wa_links enable row level security;
alter table public.wa_messages enable row level security;
alter table public.webhook_events enable row level security;

-- ── Policies ─────────────────────────────────────────────────────────────────
CREATE POLICY "anyone may leave area interest" ON public.area_interest AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "founder reads area interest" ON public.area_interest AS PERMISSIVE FOR SELECT TO public USING (is_founder());
CREATE POLICY "founder reads audit" ON public.audit_log AS PERMISSIVE FOR SELECT TO public USING (is_founder());
CREATE POLICY "founder writes audit" ON public.audit_log AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_founder());
CREATE POLICY "clients read own series" ON public.booking_series AS PERMISSIVE FOR SELECT TO public USING ((client_id = auth.uid()));
CREATE POLICY "coaches read series on their sessions" ON public.booking_series AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM class_sessions s WHERE ((s.class_id = booking_series.class_id) AND (s.coach_id = auth.uid())))));
CREATE POLICY "founder all series" ON public.booking_series AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "clients read own bookings" ON public.bookings AS PERMISSIVE FOR SELECT TO public USING ((client_id = auth.uid()));
CREATE POLICY "coaches read their rosters" ON public.bookings AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM class_sessions s WHERE ((s.id = bookings.session_id) AND (s.coach_id = auth.uid())))));
CREATE POLICY "coaches write attendance" ON public.bookings AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1 FROM class_sessions s WHERE ((s.id = bookings.session_id) AND (s.coach_id = auth.uid())))));
CREATE POLICY "founder full access" ON public.bookings AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "own credits" ON public.class_credits AS PERMISSIVE FOR SELECT TO public USING (((client_id = auth.uid()) OR is_founder()));
CREATE POLICY "founder writes credits" ON public.class_credits AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "coach updates own session notes" ON public.class_sessions AS PERMISSIVE FOR UPDATE TO public USING ((coach_id = auth.uid()));
CREATE POLICY "founder writes sessions" ON public.class_sessions AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "read scheduled sessions" ON public.class_sessions AS PERMISSIVE FOR SELECT TO public USING ((class_is_public_group(class_id) OR (coach_id = auth.uid()) OR is_founder() OR client_owns_private_class(class_id)));
CREATE POLICY "founder writes classes" ON public.classes AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "public reads active group classes" ON public.classes AS PERMISSIVE FOR SELECT TO public USING ((((active = true) AND (class_type = 'group'::class_type)) OR is_founder() OR (is_coach() AND coach_teaches_class(id)) OR client_owns_private_class(id)));
CREATE POLICY "assignments visible" ON public.coach_assignments AS PERMISSIVE FOR SELECT TO public USING (((coach_id = auth.uid()) OR is_founder()));
CREATE POLICY "founder writes assignments" ON public.coach_assignments AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "coach writes own availability" ON public.coach_availability AS PERMISSIVE FOR ALL TO public USING ((coach_id = auth.uid())) WITH CHECK ((coach_id = auth.uid()));
CREATE POLICY "founder all availability" ON public.coach_availability AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "public reads availability" ON public.coach_availability AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "coach own time off" ON public.coach_time_off AS PERMISSIVE FOR ALL TO public USING ((coach_id = auth.uid())) WITH CHECK ((coach_id = auth.uid()));
CREATE POLICY "founder all time off" ON public.coach_time_off AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "coach writes own row" ON public.coaches AS PERMISSIVE FOR UPDATE TO public USING ((id = auth.uid()));
CREATE POLICY "founder all coaches" ON public.coaches AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "founder all coach invites" ON public.coach_invites AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "public reads active coaches" ON public.coaches AS PERMISSIVE FOR SELECT TO public USING (((active = true) OR (id = auth.uid()) OR is_founder()));
CREATE POLICY "own invoices" ON public.invoices AS PERMISSIVE FOR SELECT TO public USING (((client_id = auth.uid()) OR is_founder()));
CREATE POLICY "mark own notifications read" ON public.notifications AS PERMISSIVE FOR UPDATE TO public USING ((user_id = auth.uid()));
CREATE POLICY "own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO public USING ((user_id = auth.uid()));
CREATE POLICY "own orders" ON public.orders AS PERMISSIVE FOR SELECT TO public USING (((client_id = auth.uid()) OR is_founder()));
CREATE POLICY "founder writes orders" ON public.orders AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "anyone reads active plans" ON public.plans AS PERMISSIVE FOR SELECT TO public USING (((active = true) OR is_founder()));
CREATE POLICY "founder writes plans" ON public.plans AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "anyone reads active products" ON public.products AS PERMISSIVE FOR SELECT TO public USING (((active = true) OR is_founder()));
CREATE POLICY "founder writes products" ON public.products AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "coach reads own rosters players" ON public.players AS PERMISSIVE FOR SELECT TO public USING ((is_coach() AND coach_has_player(id)));
CREATE POLICY "founder all players" ON public.players AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "own household" ON public.players AS PERMISSIVE FOR ALL TO public USING ((client_id = auth.uid())) WITH CHECK ((client_id = auth.uid()));
CREATE POLICY "founder writes private details" ON public.private_class_details AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "private details visible to owner coach founder" ON public.private_class_details AS PERMISSIVE FOR SELECT TO public USING (((client_id = auth.uid()) OR is_founder() OR coach_teaches_class(class_id)));
CREATE POLICY "founder writes ledger" ON public.private_credit_ledger AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "own ledger" ON public.private_credit_ledger AS PERMISSIVE FOR SELECT TO public USING (((client_id = auth.uid()) OR is_founder()));
CREATE POLICY "coach reads clients in own sessions" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING ((is_coach() AND coach_has_client(id)));
CREATE POLICY "founder all profiles" ON public.profiles AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "own profile" ON public.profiles AS PERMISSIVE FOR ALL TO public USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));
CREATE POLICY "own push subscriptions" ON public.push_subscriptions AS PERMISSIVE FOR ALL TO public USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "authenticated read settings" ON public.settings AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() IS NOT NULL));
CREATE POLICY "founder writes settings" ON public.settings AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "coach or founder reads notes" ON public.student_notes AS PERMISSIVE FOR SELECT TO public USING ((is_coach() OR is_founder()));
CREATE POLICY "coach or founder writes notes" ON public.student_notes AS PERMISSIVE FOR INSERT TO public WITH CHECK (((author_id = auth.uid()) AND (is_coach() OR is_founder())));
CREATE POLICY "author or founder deletes note" ON public.student_notes AS PERMISSIVE FOR DELETE TO public USING (((author_id = auth.uid()) OR is_founder()));
CREATE POLICY "founder writes subscriptions" ON public.subscriptions AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "own subscriptions" ON public.subscriptions AS PERMISSIVE FOR SELECT TO public USING (((client_id = auth.uid()) OR is_founder()));
CREATE POLICY "founder writes venues" ON public.venues AS PERMISSIVE FOR ALL TO public USING (is_founder());
CREATE POLICY "public reads active venues" ON public.venues AS PERMISSIVE FOR SELECT TO public USING (((active = true) OR is_founder()));
CREATE POLICY "founder reads webhook events" ON public.webhook_events AS PERMISSIVE FOR SELECT TO public USING (is_founder());
