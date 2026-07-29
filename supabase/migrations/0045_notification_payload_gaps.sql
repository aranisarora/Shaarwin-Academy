-- notification-fix-plan 2.5 — payload gaps at the insert sites (G3 + G4).
--
-- Templates can only render what `data` carries, and two of them have never
-- been able to say the one thing that matters:
--
--   G3  payment_failed built data as {url} only, so the template's {{2}} always
--       fell back to "your membership" — even though `body` had the plan name
--       right there. A parent gets a vague dunning message about an unnamed
--       thing they pay for.
--
--   G4  waitlist_spot carried no class_title and no claim_minutes at ANY insert
--       site, so every offer read "a spot just opened in a class" with a
--       hardcoded 15 minutes. If settings.waitlist_claim_minutes is configured
--       differently the message was also simply wrong — we'd promise a window
--       we don't honour.
--
-- The three SQL sites are fixed here; the fourth (the worker's re-offer sweep)
-- is fixed in supabase/functions/notify/index.ts in the same commit.
-- reschedule_booking's offer additionally had no `url` at all — the member was
-- told to claim a spot with nothing to tap.

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
