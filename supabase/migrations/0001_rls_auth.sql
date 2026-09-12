-- P02 — RLS policies, helper functions, signup provisioning trigger.
-- Run in the Supabase SQL editor AFTER sharwin-schema.sql.

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function public.is_founder() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'founder'
  );
$$;

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'coach'
  );
$$;

-- ── Signup provisioning: profile + self player row ──────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
begin
  insert into profiles (id, role, full_name, email)
  values (new.id, 'client', v_name, new.email)
  on conflict (id) do nothing;

  insert into players (client_id, full_name)
  select new.id, v_name
  where not exists (select 1 from players where client_id = new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Coach-visible client columns (narrow view) ──────────────────────────────
create or replace view public.coach_client_view
with (security_invoker = off) as
select p.id, p.full_name, p.avatar_url
from profiles p;

-- ── Enable RLS everywhere ────────────────────────────────────────────────────
alter table profiles              enable row level security;
alter table players               enable row level security;
alter table coaches               enable row level security;
alter table coach_availability    enable row level security;
alter table coach_time_off        enable row level security;
alter table venues                enable row level security;
alter table classes               enable row level security;
alter table private_class_details enable row level security;
alter table class_sessions        enable row level security;
alter table coach_assignments     enable row level security;
alter table bookings              enable row level security;
alter table plans                 enable row level security;
alter table subscriptions         enable row level security;
alter table private_credit_ledger enable row level security;
alter table invoices              enable row level security;
alter table webhook_events        enable row level security;
alter table notifications         enable row level security;
alter table push_subscriptions    enable row level security;
alter table area_interest         enable row level security;
alter table audit_log             enable row level security;
alter table settings              enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "founder all profiles" on profiles;
create policy "founder all profiles" on profiles
  for all using (is_founder());

drop policy if exists "coach reads clients in own sessions" on profiles;
create policy "coach reads clients in own sessions" on profiles
  for select using (
    is_coach() and exists (
      select 1 from bookings b
      join class_sessions s on s.id = b.session_id
      where b.client_id = profiles.id and s.coach_id = auth.uid()
    )
  );

-- ── players ─────────────────────────────────────────────────────────────────
drop policy if exists "own household" on players;
create policy "own household" on players
  for all using (client_id = auth.uid()) with check (client_id = auth.uid());

drop policy if exists "coach reads own rosters players" on players;
create policy "coach reads own rosters players" on players
  for select using (
    is_coach() and exists (
      select 1 from bookings b
      join class_sessions s on s.id = b.session_id
      where b.player_id = players.id and s.coach_id = auth.uid()
    )
  );

drop policy if exists "founder all players" on players;
create policy "founder all players" on players for all using (is_founder());

-- ── coaches (public bios readable by anyone) ────────────────────────────────
drop policy if exists "public reads active coaches" on coaches;
create policy "public reads active coaches" on coaches
  for select using (active = true or id = auth.uid() or is_founder());

drop policy if exists "coach writes own row" on coaches;
create policy "coach writes own row" on coaches
  for update using (id = auth.uid());

drop policy if exists "founder all coaches" on coaches;
create policy "founder all coaches" on coaches for all using (is_founder());

drop policy if exists "public reads availability" on coach_availability;
create policy "public reads availability" on coach_availability
  for select using (true);

drop policy if exists "coach writes own availability" on coach_availability;
create policy "coach writes own availability" on coach_availability
  for all using (coach_id = auth.uid()) with check (coach_id = auth.uid());

drop policy if exists "founder all availability" on coach_availability;
create policy "founder all availability" on coach_availability for all using (is_founder());

drop policy if exists "coach own time off" on coach_time_off;
create policy "coach own time off" on coach_time_off
  for all using (coach_id = auth.uid()) with check (coach_id = auth.uid());

drop policy if exists "founder all time off" on coach_time_off;
create policy "founder all time off" on coach_time_off for all using (is_founder());

-- ── venues / classes / sessions ─────────────────────────────────────────────
drop policy if exists "public reads active venues" on venues;
create policy "public reads active venues" on venues
  for select using (active = true or is_founder());

drop policy if exists "founder writes venues" on venues;
create policy "founder writes venues" on venues for all using (is_founder());

drop policy if exists "public reads active group classes" on classes;
create policy "public reads active group classes" on classes
  for select using (
    (active = true and class_type = 'group')
    or is_founder()
    or (is_coach() and exists (
      select 1 from class_sessions s
      where s.class_id = classes.id and s.coach_id = auth.uid()
    ))
    or exists (
      select 1 from private_class_details d
      where d.class_id = classes.id and d.client_id = auth.uid()
    )
  );

drop policy if exists "founder writes classes" on classes;
create policy "founder writes classes" on classes for all using (is_founder());

drop policy if exists "read scheduled sessions" on class_sessions;
create policy "read scheduled sessions" on class_sessions
  for select using (
    exists (select 1 from classes c where c.id = class_sessions.class_id
            and c.active = true and c.class_type = 'group')
    or coach_id = auth.uid()
    or is_founder()
    or exists (
      select 1 from private_class_details d
      where d.class_id = class_sessions.class_id and d.client_id = auth.uid()
    )
  );

drop policy if exists "coach updates own session notes" on class_sessions;
create policy "coach updates own session notes" on class_sessions
  for update using (coach_id = auth.uid());

drop policy if exists "founder writes sessions" on class_sessions;
create policy "founder writes sessions" on class_sessions for all using (is_founder());

drop policy if exists "private details visible to owner coach founder" on private_class_details;
create policy "private details visible to owner coach founder" on private_class_details
  for select using (
    client_id = auth.uid()
    or is_founder()
    or exists (
      select 1 from class_sessions s
      where s.class_id = private_class_details.class_id and s.coach_id = auth.uid()
    )
  );

drop policy if exists "founder writes private details" on private_class_details;
create policy "founder writes private details" on private_class_details
  for all using (is_founder());

drop policy if exists "assignments visible" on coach_assignments;
create policy "assignments visible" on coach_assignments
  for select using (coach_id = auth.uid() or is_founder());

drop policy if exists "founder writes assignments" on coach_assignments;
create policy "founder writes assignments" on coach_assignments
  for all using (is_founder());

-- ── bookings (writes only via RPCs — SECURITY DEFINER bypasses RLS) ────────
drop policy if exists "clients read own bookings" on bookings;
create policy "clients read own bookings" on bookings
  for select using (client_id = auth.uid());

drop policy if exists "coaches read their rosters" on bookings;
create policy "coaches read their rosters" on bookings
  for select using (exists (
    select 1 from class_sessions s
    where s.id = bookings.session_id and s.coach_id = auth.uid()
  ));

drop policy if exists "coaches write attendance" on bookings;
create policy "coaches write attendance" on bookings
  for update using (exists (
    select 1 from class_sessions s
    where s.id = bookings.session_id and s.coach_id = auth.uid()
  ));

drop policy if exists "founder full access" on bookings;
create policy "founder full access" on bookings for all using (is_founder());

-- ── billing ─────────────────────────────────────────────────────────────────
drop policy if exists "anyone reads active plans" on plans;
create policy "anyone reads active plans" on plans
  for select using (active = true or is_founder());

drop policy if exists "founder writes plans" on plans;
create policy "founder writes plans" on plans for all using (is_founder());

drop policy if exists "own subscriptions" on subscriptions;
create policy "own subscriptions" on subscriptions
  for select using (client_id = auth.uid() or is_founder());

drop policy if exists "founder writes subscriptions" on subscriptions;
create policy "founder writes subscriptions" on subscriptions
  for all using (is_founder());

drop policy if exists "own ledger" on private_credit_ledger;
create policy "own ledger" on private_credit_ledger
  for select using (client_id = auth.uid() or is_founder());

drop policy if exists "founder writes ledger" on private_credit_ledger;
create policy "founder writes ledger" on private_credit_ledger
  for all using (is_founder());

drop policy if exists "own invoices" on invoices;
create policy "own invoices" on invoices
  for select using (client_id = auth.uid() or is_founder());

drop policy if exists "founder reads webhook events" on webhook_events;
create policy "founder reads webhook events" on webhook_events
  for select using (is_founder());

-- ── notifications ───────────────────────────────────────────────────────────
drop policy if exists "own notifications" on notifications;
create policy "own notifications" on notifications
  for select using (user_id = auth.uid());

drop policy if exists "mark own notifications read" on notifications;
create policy "mark own notifications read" on notifications
  for update using (user_id = auth.uid());

drop policy if exists "own push subscriptions" on push_subscriptions;
create policy "own push subscriptions" on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── ops ─────────────────────────────────────────────────────────────────────
drop policy if exists "anyone may leave area interest" on area_interest;
create policy "anyone may leave area interest" on area_interest
  for insert with check (true);

drop policy if exists "founder reads area interest" on area_interest;
create policy "founder reads area interest" on area_interest
  for select using (is_founder());

drop policy if exists "founder reads audit" on audit_log;
create policy "founder reads audit" on audit_log
  for select using (is_founder());

drop policy if exists "authenticated read settings" on settings;
create policy "authenticated read settings" on settings
  for select using (auth.uid() is not null);

drop policy if exists "founder writes settings" on settings;
create policy "founder writes settings" on settings
  for all using (is_founder());
