-- Notifications name a location in four places — the cover offer, the coach's
-- "have you reached?", the parent's "coach has arrived", and the founder's
-- booking ping. All four resolve it the same way:
--
--   coalesce(venues.name, private_class_details.address, 'the venue')
--
-- which is right for a group class (always has venue_id) and right for a
-- private in someone's home, but wrong for the case that actually dominates the
-- book: a private held AT a known academy venue. Those rows carry no venue_id —
-- the address was geocoded from the picker — so the coach is told to go to
-- "Adarsh Palm Retreat, Bengaluru, Bengaluru Urban, Karnataka, India" instead of
-- "APR Apartments", the name they and the parents actually use. 16 of the 20
-- distinct private addresses on the book are byte-identical to a venue address.
--
-- This adds one resolver and points all four call sites at it. Matching is
-- deliberately exact (case- and whitespace-normalised only): a private in a
-- villa 200m from a venue must keep its own address, so nothing fuzzy or
-- distance-based is used. When no venue matches, the address is returned
-- unchanged — a home private still shows the home address, which is the whole
-- point of sending it to the coach.

-- Row-typed so PostgREST exposes it as a computed field on `classes`: the notify
-- worker selects `classes(title,location_label)` and gets the same string the
-- SQL callers below build, instead of resolving it a second time in TypeScript.
-- SECURITY INVOKER on purpose — a caller who cannot see a private_class_details
-- row under RLS gets null rather than someone's home address. The SECURITY
-- DEFINER functions below, and the worker's service-role client, see everything.
CREATE OR REPLACE FUNCTION public.location_label(c public.classes)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    -- A real venue booking always wins.
    (select v.name from venues v where v.id = c.venue_id),
    -- A private whose address IS a venue's address: use the name.
    (select v.name
       from private_class_details pcd
       join venues v
         on lower(regexp_replace(btrim(v.address), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(pcd.address), '\s+', ' ', 'g'))
      where pcd.class_id = c.id
        and btrim(coalesce(pcd.address, '')) <> ''
      order by v.active desc, v.name
      limit 1),
    -- Otherwise the address as given.
    (select nullif(btrim(pcd.address), '')
       from private_class_details pcd where pcd.class_id = c.id)
  );
$function$;

COMMENT ON FUNCTION public.location_label(public.classes) IS
  'Human-readable location for a class: venue name, else the venue whose address matches a private''s address, else the private address. Exposed by PostgREST as a computed field on classes.';

-- Convenience wrapper for the plpgsql callers, which hold a class id.
CREATE OR REPLACE FUNCTION public.class_location_label(p_class uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select location_label(c) from classes c where c.id = p_class;
$function$;

-- ── Call site 1: cover offers to coaches ────────────────────────────────────
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
  v_count   int := 0;
  r record;
begin
  select * into v_session from class_sessions where id = p_session;
  if not found or v_session.status <> 'scheduled' then return 0; end if;
  if v_session.coach_id is not null then return 0; end if;
  if v_session.starts_at <= now() then return 0; end if;

  select * into v_class from classes where id = v_session.class_id;

  v_where := coalesce(class_location_label(v_session.class_id), 'the venue');

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
      || ' needs a coach. First to claim it takes it — reply "claim" if you can cover.',
      jsonb_build_object('session_id', p_session,
                         'class_title', coalesce(v_class.title, 'a session'),
                         'time_str', v_when,
                         'location_str', v_where,
                         'url', '/coach/calendar'));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- ── Call site 2: "coach has arrived" to the parents ─────────────────────────
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

-- ── Call site 3: the founder ops ping on every new booking ─────────────────
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
