-- Carry the chosen location through every path that creates a private, so the
-- picker's answer survives instead of being re-guessed downstream.
--
-- The gap this closes: private_booking_series stored only the raw address, so
-- the nightly generate_private_sessions re-derived a label for every week it
-- materialised. A location fixed once on the series would silently revert on
-- the next roll of the horizon.

alter table public.private_booking_series
  add column if not exists venue_id uuid references public.venues(id) on delete set null,
  add column if not exists venue_label text,
  add column if not exists unit_label text;

-- Inherit from whatever the series has already produced: every occurrence was
-- attached to a venue by 0053, and they all share one address.
update public.private_booking_series s
   set venue_id = x.venue_id, unit_label = x.unit_label
  from (
    select distinct on (b.private_series_id)
           b.private_series_id as series_id, c.venue_id, pcd.unit_label
      from bookings b
      join class_sessions cs on cs.id = b.session_id
      join classes c on c.id = cs.class_id
      join private_class_details pcd on pcd.class_id = c.id
     where b.private_series_id is not null
     order by b.private_series_id, cs.starts_at
  ) x
 where x.series_id = s.id and s.venue_id is null;

-- The one place a private is created. p_venue_id is the answer the picker gave;
-- p_venue_label is only for somewhere we hold no venue row for. Both trail the
-- signature with defaults so the existing positional callers stay valid.
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

-- By-id twin of location_maps_url(classes), for the booking-time callers that
-- hold a class id rather than a row (mirrors class_location_label).
CREATE OR REPLACE FUNCTION public.class_location_maps_url(p_class uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select location_maps_url(c) from classes c where c.id = p_class;
$function$;

-- Client one-off.
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

-- Client weekly series. The location is stored ON the series so the nightly
-- generator below reuses it instead of re-deriving one.
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

-- Nightly horizon roll. Passes the series' stored location through, so a
-- location corrected on the series stays corrected on every future week.
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
