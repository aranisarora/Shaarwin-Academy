-- Standardized structured address capture.
--
-- Adds an additive `address_details jsonb` column next to the existing flat
-- `address`/`postcode`/`lat`/`lng` columns on every surface that stores a
-- location. The flat columns are kept (coverage checks and maps depend on
-- lat/lng; the formatted line stays backward-compatible). The JSONB holds the
-- structured, industry-standard shape (see lib/address.ts StructuredAddress):
--   { formatted, locality, subLocality, city, state, postcode, country,
--     lat, lng, flat, building, floorTower, landmark, accessNotes, label }
--
-- Coaches only get a base-location string (`base_address`) — a point, not a
-- full deliverable address.

alter table public.venues                add column if not exists address_details jsonb;
alter table public.private_class_details add column if not exists address_details jsonb;
alter table public.profiles              add column if not exists address_details jsonb;
alter table public.coaches               add column if not exists base_address text;

-- Backfill existing rows from the flat columns so pre-migration data renders
-- through the shared display without a fromLegacy() fallback.
update public.venues
set address_details = jsonb_build_object(
  'formatted', address,
  'postcode',  postcode,
  'lat',       lat,
  'lng',       lng
)
where address_details is null;

update public.private_class_details
set address_details = jsonb_build_object(
  'formatted',    address,
  'postcode',     postcode,
  'lat',          lat,
  'lng',          lng,
  'accessNotes',  access_notes
)
where address_details is null;

update public.profiles
set address_details = jsonb_build_object(
  'formatted', default_address,
  'lat',       default_lat,
  'lng',       default_lng
)
where address_details is null
  and default_address is not null;

-- Persist the structured snapshot on private bookings. Null-safe: the key is
-- absent for legacy callers, so `payload->'address_details'` inserts NULL.
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
  if not has_active_subscription(v_client) then raise exception 'no_active_subscription'; end if;

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
