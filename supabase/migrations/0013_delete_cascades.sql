-- 0013: full delete-cascade graph for user deletion.
--
-- Goal: deleting a row from auth.users (dashboard → Authentication → Users, or
-- `delete from auth.users where …`) must remove ALL of that user's data without
-- tripping a foreign-key RESTRICT, while preserving shared/operational records.
--
-- auth.users → profiles already cascades (schema), and profiles → coaches too.
-- This migration fills the FKs that were created with no ON DELETE action
-- (default RESTRICT) so they either CASCADE (personal data) or SET NULL
-- (authorship/audit/assignment references that must outlive the actor).
--
-- Two rules of thumb:
--   • Data the user OWNS (bookings, private-class details)      → ON DELETE CASCADE
--   • Records that merely REFERENCE a user (created_by, actor,
--     assigned_by, decided_by, updated_by, an assigned coach)   → ON DELETE SET NULL
--
-- FK constraint names are Postgres defaults: <table>_<column>_fkey.

begin;

-- ── Personal data owned by the client → CASCADE ─────────────────────────────
alter table bookings drop constraint if exists bookings_client_id_fkey;
alter table bookings
  add constraint bookings_client_id_fkey
  foreign key (client_id) references profiles(id) on delete cascade;

alter table bookings drop constraint if exists bookings_player_id_fkey;
alter table bookings
  add constraint bookings_player_id_fkey
  foreign key (player_id) references players(id) on delete cascade;

alter table private_class_details drop constraint if exists private_class_details_client_id_fkey;
alter table private_class_details
  add constraint private_class_details_client_id_fkey
  foreign key (client_id) references profiles(id) on delete cascade;

alter table private_class_details drop constraint if exists private_class_details_player_id_fkey;
alter table private_class_details
  add constraint private_class_details_player_id_fkey
  foreign key (player_id) references players(id) on delete cascade;

-- Recurring standing reservation (0012). player_id/class_id already cascade;
-- client_id did not, which blocks the profile delete.
alter table booking_series drop constraint if exists booking_series_client_id_fkey;
alter table booking_series
  add constraint booking_series_client_id_fkey
  foreign key (client_id) references profiles(id) on delete cascade;

-- ── Coach references ────────────────────────────────────────────────────────
-- A deleted coach must not take live sessions down with them: drop the session
-- into the UNASSIGNED lane (coach_id IS NULL), which the engine already handles.
alter table class_sessions drop constraint if exists class_sessions_coach_id_fkey;
alter table class_sessions
  add constraint class_sessions_coach_id_fkey
  foreign key (coach_id) references coaches(id) on delete set null;

-- Assignment history is meaningless without its coach (coach_id is NOT NULL),
-- so the history row goes with the coach.
alter table coach_assignments drop constraint if exists coach_assignments_coach_id_fkey;
alter table coach_assignments
  add constraint coach_assignments_coach_id_fkey
  foreign key (coach_id) references coaches(id) on delete cascade;

-- ── Authorship / audit "who did this" → SET NULL (keep the record) ──────────
alter table classes drop constraint if exists classes_created_by_fkey;
alter table classes
  add constraint classes_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

alter table coach_assignments drop constraint if exists coach_assignments_assigned_by_fkey;
alter table coach_assignments
  add constraint coach_assignments_assigned_by_fkey
  foreign key (assigned_by) references profiles(id) on delete set null;

alter table coach_time_off drop constraint if exists coach_time_off_decided_by_fkey;
alter table coach_time_off
  add constraint coach_time_off_decided_by_fkey
  foreign key (decided_by) references profiles(id) on delete set null;

alter table audit_log drop constraint if exists audit_log_actor_id_fkey;
alter table audit_log
  add constraint audit_log_actor_id_fkey
  foreign key (actor_id) references profiles(id) on delete set null;

alter table settings drop constraint if exists settings_updated_by_fkey;
alter table settings
  add constraint settings_updated_by_fkey
  foreign key (updated_by) references profiles(id) on delete set null;

-- ── Defensive rules for general (non-user) deletes ──────────────────────────
-- These don't block user deletion today (the referencing rows cascade away with
-- the same client), but without an action they turn any *other* delete of a
-- booking/subscription into a RESTRICT error. SET NULL keeps the surviving row.
alter table bookings drop constraint if exists bookings_rescheduled_from_fkey;
alter table bookings
  add constraint bookings_rescheduled_from_fkey
  foreign key (rescheduled_from) references bookings(id) on delete set null;

alter table private_credit_ledger drop constraint if exists private_credit_ledger_booking_id_fkey;
alter table private_credit_ledger
  add constraint private_credit_ledger_booking_id_fkey
  foreign key (booking_id) references bookings(id) on delete set null;

alter table private_credit_ledger drop constraint if exists private_credit_ledger_subscription_id_fkey;
alter table private_credit_ledger
  add constraint private_credit_ledger_subscription_id_fkey
  foreign key (subscription_id) references subscriptions(id) on delete set null;

alter table invoices drop constraint if exists invoices_subscription_id_fkey;
alter table invoices
  add constraint invoices_subscription_id_fkey
  foreign key (subscription_id) references subscriptions(id) on delete set null;

-- bookings.series_id (0012) → keep the booking if its series is deleted directly.
alter table bookings drop constraint if exists bookings_series_id_fkey;
alter table bookings
  add constraint bookings_series_id_fkey
  foreign key (series_id) references booking_series(id) on delete set null;

commit;
