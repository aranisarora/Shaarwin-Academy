-- When a recurring series is booked, book_series inserts one booking row per
-- future occurrence. The ops_notify_booking_created trigger was firing for every
-- insert, flooding founders with one WhatsApp per session. Now it only fires for
-- the first booking in a series (series_id / private_series_id not yet seen).
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
