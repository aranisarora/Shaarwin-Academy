-- 0018 — Founder ops feed + coach session confirmation.
--
-- Gives the founder(s) a complete, specific play-by-play of the academy over
-- the existing notifications pipeline (P11 worker → WhatsApp/email):
--   · signup funnel: account created, player added, WhatsApp linked,
--     free-trial / drop-in credit used
--   · bookings: every booking, waitlist join/claim, reschedule, client
--     cancellation — with client, player, class, time, venue and headcount
--   · attendance: coach-marked attended / no-show (auto-sweep marks are silent)
--   · coaching: assignment changes on upcoming sessions, coach confirmations
--   · money: new/recovered/cancelled memberships, renewal payments, one-off
--     purchases, payments going past due (client also gets payment_failed)
--
-- All founder types use an "ops_" prefix so admins can mute categories via
-- profiles.notification_prefs. Triggers are SECURITY DEFINER so they can
-- insert notifications regardless of the acting user's RLS.
--
-- Also adds class_sessions.coach_confirmed_at + coach_confirm_session() so
-- coaches can say "I'm coming" (web + WhatsApp); the notify worker nudges
-- unconfirmed coaches and escalates to the founder near start time.

set search_path = public;

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.notify_founders(
  p_type text, p_title text, p_body text, p_data jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, title, body, data)
  select p.id, p_type, p_title, p_body, p_data
  from profiles p
  where p.role = 'founder' and p.deleted_at is null;
$$;

create or replace function public.fmt_ist(ts timestamptz) returns text
language sql immutable as $$
  select to_char(ts at time zone 'Asia/Kolkata', 'Dy DD Mon, FMHH12:MI am');
$$;

create or replace function public.fmt_inr(p_paise integer) returns text
language sql immutable as $$
  select '₹' || to_char(round(p_paise / 100.0), 'FM9999999990');
$$;

-- ── Coach confirmation ───────────────────────────────────────────────────────

alter table public.class_sessions
  add column if not exists coach_confirmed_at timestamptz;

create or replace function public.coach_confirm_session(p_session uuid)
returns timestamptz
language plpgsql security definer set search_path = public as $function$
declare
  v_session class_sessions%rowtype;
  v_name    text;
  v_title   text;
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

  select split_part(coalesce(nullif(trim(full_name), ''), 'Coach'), ' ', 1)
    into v_name from profiles where id = v_session.coach_id;
  select title into v_title from classes where id = v_session.class_id;

  perform notify_founders('ops_coach_confirmed', 'Coach confirmed',
    'Coach ' || v_name || ' confirmed they''re taking ' || coalesce(v_title, 'a session')
    || ' — ' || fmt_ist(v_session.starts_at) || '.',
    jsonb_build_object('session_id', p_session, 'url', '/admin/calendar'));

  return v_at;
end;
$function$;

grant execute on function public.coach_confirm_session(uuid) to authenticated;

-- Reset confirmation/arrival when the session moves or the coach changes —
-- the (new) coach hasn't agreed to the (new) slot.
create or replace function public.reset_session_confirmation()
returns trigger
language plpgsql security definer set search_path = public as $function$
begin
  if new.coach_id is distinct from old.coach_id
     or new.starts_at is distinct from old.starts_at then
    new.coach_confirmed_at := null;
    new.coach_arrived_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists class_sessions_reset_confirmation on public.class_sessions;
create trigger class_sessions_reset_confirmation
  before update of coach_id, starts_at on public.class_sessions
  for each row execute function reset_session_confirmation();

-- ── Signup funnel ────────────────────────────────────────────────────────────

create or replace function public.ops_notify_new_profile()
returns trigger
language plpgsql security definer set search_path = public as $function$
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

drop trigger if exists profiles_ops_feed on public.profiles;
create trigger profiles_ops_feed
  after insert on public.profiles
  for each row execute function ops_notify_new_profile();

create or replace function public.ops_notify_new_player()
returns trigger
language plpgsql security definer set search_path = public as $function$
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

drop trigger if exists players_ops_feed on public.players;
create trigger players_ops_feed
  after insert on public.players
  for each row execute function ops_notify_new_player();

create or replace function public.ops_notify_wa_linked()
returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  v_name text;
begin
  select full_name into v_name from profiles where id = new.user_id;
  perform notify_founders('ops_wa_linked', 'WhatsApp linked',
    coalesce(v_name, 'A user') || ' linked WhatsApp (' || new.phone || ').',
    jsonb_build_object('client_id', new.user_id, 'url', '/admin/clients'));
  return new;
end;
$function$;

drop trigger if exists wa_links_ops_feed on public.wa_links;
create trigger wa_links_ops_feed
  after insert on public.wa_links
  for each row execute function ops_notify_wa_linked();

create or replace function public.ops_notify_credit_used()
returns trigger
language plpgsql security definer set search_path = public as $function$
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

drop trigger if exists class_credits_ops_feed on public.class_credits;
create trigger class_credits_ops_feed
  after update on public.class_credits
  for each row execute function ops_notify_credit_used();

-- ── Bookings ─────────────────────────────────────────────────────────────────

create or replace function public.ops_notify_booking_created()
returns trigger
language plpgsql security definer set search_path = public as $function$
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

  if v_class.class_type = 'private' then
    select address into v_where from private_class_details where class_id = v_class.id;
  else
    select name into v_where from venues where id = v_class.venue_id;
  end if;

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

drop trigger if exists bookings_ops_feed_insert on public.bookings;
create trigger bookings_ops_feed_insert
  after insert on public.bookings
  for each row execute function ops_notify_booking_created();

create or replace function public.ops_notify_booking_status()
returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  v_session class_sessions%rowtype;
  v_class   classes%rowtype;
  v_player  text;
  v_client  text;
  v_who     text;
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
  elsif new.status = 'no_show' then
    perform notify_founders('ops_attendance', 'No-show',
      coalesce(v_player, 'A player') || ' did NOT show for ' || v_class.title
      || ' (' || fmt_ist(v_session.starts_at) || ').',
      jsonb_build_object('booking_id', new.id, 'session_id', new.session_id, 'url', '/admin/calendar'));
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

drop trigger if exists bookings_ops_feed_status on public.bookings;
create trigger bookings_ops_feed_status
  after update of status on public.bookings
  for each row execute function ops_notify_booking_status();

-- ── Coach assignment changes on upcoming sessions ────────────────────────────

create or replace function public.ops_notify_coach_change()
returns trigger
language plpgsql security definer set search_path = public as $function$
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

drop trigger if exists class_sessions_ops_feed on public.class_sessions;
create trigger class_sessions_ops_feed
  after update of coach_id on public.class_sessions
  for each row execute function ops_notify_coach_change();

-- ── Money: memberships, payments, dunning ────────────────────────────────────

create or replace function public.ops_notify_subscription()
returns trigger
language plpgsql security definer set search_path = public as $function$
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
      jsonb_build_object('url', '/app/billing'));
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

drop trigger if exists subscriptions_ops_feed on public.subscriptions;
create trigger subscriptions_ops_feed
  after insert or update of status on public.subscriptions
  for each row execute function ops_notify_subscription();

create or replace function public.ops_notify_invoice()
returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  v_client text;
  v_plan   text;
begin
  -- One-off purchases are reported via the orders trigger; this covers renewals.
  if new.status <> 'paid' or new.subscription_id is null then return new; end if;
  select full_name into v_client from profiles where id = new.client_id;
  select p.name into v_plan
  from subscriptions s join plans p on p.id = s.plan_id
  where s.id = new.subscription_id;
  perform notify_founders('ops_payment', 'Payment received',
    fmt_inr(new.amount_pence) || ' from ' || coalesce(v_client, 'a client')
    || ' — ' || coalesce(v_plan, 'membership') || ' renewal.',
    jsonb_build_object('client_id', new.client_id, 'url', '/admin/billing'));
  return new;
end;
$function$;

drop trigger if exists invoices_ops_feed on public.invoices;
create trigger invoices_ops_feed
  after insert on public.invoices
  for each row execute function ops_notify_invoice();

create or replace function public.ops_notify_order_paid()
returns trigger
language plpgsql security definer set search_path = public as $function$
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
  return new;
end;
$function$;

drop trigger if exists orders_ops_feed on public.orders;
create trigger orders_ops_feed
  after insert or update of status on public.orders
  for each row execute function ops_notify_order_paid();
